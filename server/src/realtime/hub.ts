import type { Response } from 'express';

// ---------------------------------------------------------------------------
// Minimal Server-Sent Events hub. Clients subscribe to a topic (e.g. an
// invoice being received) and the receiving service pushes authoritative
// progress updates so every device on the dock sees live counts. SSE is used
// over WebSockets because it is one-directional (server -> client), auto-
// reconnects natively in the browser, and needs zero extra dependencies.
// ---------------------------------------------------------------------------

type Client = { id: number; res: Response };

const topics = new Map<string, Set<Client>>();
let nextClientId = 1;

// Guardrails against connection-exhaustion (DoS) from unbounded SSE subscriptions.
const MAX_TOTAL_CONNECTIONS = 1000;
const MAX_CONNECTIONS_PER_USER = 10;
const MAX_STREAM_LIFETIME_MS = 30 * 60 * 1000;
let totalConnections = 0;
const perUserConnections = new Map<number, number>();

export function invoiceTopic(invoiceRef: number): string {
  return `invoice:${invoiceRef}`;
}

export function subscribe(topic: string, res: Response, opts: { userId?: number } = {}): void {
  const { userId } = opts;

  // Reject when at capacity (global or per-user) before opening the stream.
  if (totalConnections >= MAX_TOTAL_CONNECTIONS) {
    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Server is at streaming capacity. Please retry shortly.');
    return;
  }
  if (userId !== undefined && (perUserConnections.get(userId) ?? 0) >= MAX_CONNECTIONS_PER_USER) {
    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Too many open streams for this account.');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Open the stream and suggest a client reconnect delay.
  res.write('retry: 3000\n\n');

  const client: Client = { id: nextClientId++, res };
  let set = topics.get(topic);
  if (!set) {
    set = new Set();
    topics.set(topic, set);
  }
  set.add(client);
  totalConnections++;
  if (userId !== undefined) perUserConnections.set(userId, (perUserConnections.get(userId) ?? 0) + 1);

  let closed = false;
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      cleanup();
    }
  }, 25_000);
  // Bound the lifetime of any single stream so leaked/zombie connections are reaped.
  const lifetime = setTimeout(() => {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    cleanup();
  }, MAX_STREAM_LIFETIME_MS);
  heartbeat.unref?.();
  lifetime.unref?.();

  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    const s = topics.get(topic);
    if (s) {
      s.delete(client);
      if (s.size === 0) topics.delete(topic);
    }
    totalConnections = Math.max(0, totalConnections - 1);
    if (userId !== undefined) {
      const remaining = (perUserConnections.get(userId) ?? 1) - 1;
      if (remaining <= 0) perUserConnections.delete(userId);
      else perUserConnections.set(userId, remaining);
    }
  }

  res.on('close', cleanup);
}

export function publish(topic: string, event: string, data: unknown): void {
  const set = topics.get(topic);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) {
    try {
      client.res.write(payload);
    } catch {
      set.delete(client);
    }
  }
}

export function subscriberCount(topic: string): number {
  return topics.get(topic)?.size ?? 0;
}
