import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { InvoiceDetail, InvoiceLine, InvoiceStatus, ReceivingUpdate } from '../../api/types';
import { useToast } from '../../components/Toast';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge, VarianceBadge } from '../../components/StatusBadge';
import { ScannerInput } from '../../components/ScannerInput';
import { CameraScanner } from '../../components/CameraScanner';

const FLUSH_MS = 180;
const FLUSH_THRESHOLD = 20;

interface QueuedEvent {
  itemSku: string;
  type: 'SCAN' | 'MANUAL_INCREMENT';
  clientEventId: string;
}

export function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceRef = Number(id);
  const toast = useToast();

  const [header, setHeader] = useState<Pick<InvoiceDetail, 'invoiceId' | 'vendorName' | 'warehouseCode'> | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [status, setStatus] = useState<InvoiceStatus>('OPEN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'scanner' | 'camera'>('scanner');
  const [lastScan, setLastScan] = useState<{ name: string; sku: string; qty: number } | null>(null);
  const [unknownCount, setUnknownCount] = useState(0);
  const [flashSku, setFlashSku] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ lineId: number; qty: string; reason: string } | null>(null);

  // Synchronous source of truth for optimistic counts (avoids stale closures
  // under rapid fire). `lines` state is derived from this map for rendering.
  const countsRef = useRef<Map<string, InvoiceLine>>(new Map());
  const queueRef = useRef<QueuedEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const eventSeq = useRef(0);
  // Per-SKU count of scans not yet reflected in the latest authoritative value
  // (queued + in-flight). Keeps optimistic counts from being clobbered when a
  // reconcile frame (flush response or an SSE frame) reflects an older state.
  const pendingRef = useRef<Map<string, number>>(new Map());

  const snapshot = useCallback(() => setLines(Array.from(countsRef.current.values()).map((l) => ({ ...l }))), []);

  const reconcile = useCallback(
    (serverLines: InvoiceLine[], nextStatus?: InvoiceStatus) => {
      for (const sl of serverLines) {
        const local = countsRef.current.get(sl.itemSku);
        if (local) {
          const pending = pendingRef.current.get(sl.itemSku) ?? 0;
          local.receivedQuantity = sl.receivedQuantity + pending;
          local.variance = local.expectedQuantity - local.receivedQuantity;
        }
      }
      snapshot();
      if (nextStatus) setStatus(nextStatus);
    },
    [snapshot],
  );

  // flushRef breaks the flush <-> scheduleFlush cycle: scheduleFlush is stable
  // and calls the latest flush via the ref.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const scheduleFlush = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, FLUSH_MS);
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const batch = queueRef.current;
    if (batch.length === 0) return;
    queueRef.current = [];
    // These scans are now in flight; drop them from "pending" assuming they will
    // be acknowledged (so a concurrent reconcile frame does not double-add them).
    // Restored if the request fails.
    for (const ev of batch) pendingRef.current.set(ev.itemSku, (pendingRef.current.get(ev.itemSku) ?? 0) - 1);
    flushingRef.current = true;
    try {
      const upd = await api.post<ReceivingUpdate>(`/receiving/invoices/${invoiceRef}/scan-batch`, { events: batch });
      reconcile(upd.lines, upd.status);
    } catch (e) {
      for (const ev of batch) pendingRef.current.set(ev.itemSku, (pendingRef.current.get(ev.itemSku) ?? 0) + 1);
      queueRef.current = [...batch, ...queueRef.current]; // retry failed batch
      toast.error(e instanceof ApiError ? e.message : 'Scan sync failed - retrying');
    } finally {
      flushingRef.current = false;
      if (queueRef.current.length > 0) scheduleFlush();
    }
  }, [invoiceRef, reconcile, toast, scheduleFlush]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const handleScan = useCallback(
    (rawSku: string, type: 'SCAN' | 'MANUAL_INCREMENT' = 'SCAN') => {
      const sku = rawSku.trim();
      if (!sku) return;
      const line = countsRef.current.get(sku);
      if (!line) {
        setUnknownCount((c) => c + 1);
        toast.error(`Unknown SKU: ${sku}`);
        return;
      }
      line.receivedQuantity += 1;
      line.variance = line.expectedQuantity - line.receivedQuantity;
      snapshot();
      setLastScan({ name: line.itemName, sku: line.itemSku, qty: line.receivedQuantity });
      setFlashSku(sku);
      setTimeout(() => setFlashSku((s) => (s === sku ? null : s)), 600);

      queueRef.current.push({ itemSku: sku, type, clientEventId: `c${Date.now()}-${eventSeq.current++}` });
      pendingRef.current.set(sku, (pendingRef.current.get(sku) ?? 0) + 1);
      if (queueRef.current.length >= FLUSH_THRESHOLD) void flush();
      else scheduleFlush();
    },
    [flush, scheduleFlush, snapshot, toast],
  );

  // Initial load
  useEffect(() => {
    let active = true;
    api
      .get<{ invoice: InvoiceDetail }>(`/invoices/${invoiceRef}`)
      .then((r) => {
        if (!active) return;
        const inv = r.invoice;
        setHeader({ invoiceId: inv.invoiceId, vendorName: inv.vendorName, warehouseCode: inv.warehouseCode });
        setStatus(inv.status);
        const map = new Map<string, InvoiceLine>();
        for (const l of inv.lines) map.set(l.itemSku, { ...l });
        countsRef.current = map;
        setLines(Array.from(map.values()));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load invoice'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [invoiceRef]);

  // Live SSE progress (multi-device sync)
  useEffect(() => {
    if (loading || error) return;
    const es = api.sse(`/receiving/invoices/${invoiceRef}/stream`);
    es.addEventListener('progress', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { lines: InvoiceLine[]; status: InvoiceStatus };
        reconcile(data.lines, data.status);
      } catch {
        /* ignore malformed frame */
      }
    });
    return () => es.close();
  }, [invoiceRef, loading, error, reconcile]);

  // Flush any pending scans on unmount
  useEffect(() => () => void flush(), [flush]);

  const totals = useMemo(() => {
    let expected = 0;
    let received = 0;
    for (const l of lines) {
      expected += l.expectedQuantity;
      received += l.receivedQuantity;
    }
    return { expected, received };
  }, [lines]);

  const submitOverride = async () => {
    if (!edit) return;
    const qty = Number(edit.qty);
    if (!Number.isInteger(qty) || qty < 0) {
      toast.error('Quantity must be a non-negative whole number');
      return;
    }
    try {
      const upd = await api.post<ReceivingUpdate>(
        `/receiving/invoices/${invoiceRef}/lines/${edit.lineId}/override`,
        { quantity: qty, reason: edit.reason || undefined },
      );
      reconcile(upd.lines, upd.status);
      toast.success('Override recorded');
      setEdit(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Override failed');
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <span className="spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="container narrow">
        <div className="alert alert-error mb">{error}</div>
        <Link className="btn" to="/hub">
          ← Back to invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="flex between items-center mb">
        <div>
          <Link to="/hub" className="muted" style={{ fontSize: '0.85rem' }}>
            ← Invoices
          </Link>
          <h1 style={{ margin: '4px 0 0' }}>{header?.invoiceId}</h1>
          <div className="dim">
            {header?.vendorName} · {header?.warehouseCode}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid cols-2">
        {/* Scan console */}
        <div className="card">
          <div className="pill-row mb">
            <div className={`pill ${mode === 'scanner' ? 'active' : ''}`} onClick={() => setMode('scanner')}>
              ⌨️ Scanner / manual
            </div>
            <div className={`pill ${mode === 'camera' ? 'active' : ''}`} onClick={() => setMode('camera')}>
              📷 Camera
            </div>
          </div>

          {mode === 'scanner' ? (
            <ScannerInput onScan={(sku) => handleScan(sku, 'SCAN')} />
          ) : (
            <CameraScanner onDetected={(sku) => handleScan(sku, 'SCAN')} />
          )}

          <div className="scan-count mt">
            {lastScan ? (
              <>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Last scanned
                </div>
                <div className="big">{lastScan.qty}</div>
                <div className="dim">{lastScan.name}</div>
                <div className="tag">{lastScan.sku}</div>
              </>
            ) : (
              <div className="muted center" style={{ padding: '20px 0' }}>
                Scan an item to begin. Counts increment in real time.
              </div>
            )}
          </div>

          {unknownCount > 0 && (
            <div className="alert alert-warn mt">
              {unknownCount} scan(s) did not match any SKU on this invoice.
            </div>
          )}
        </div>

        {/* Progress overview */}
        <div className="card">
          <div className="card-head">
            <h3>Progress</h3>
            <span className="mono">
              {totals.received} / {totals.expected} units
            </span>
          </div>
          <ProgressBar value={totals.received} max={totals.expected} />
          <div className="grid cols-3 mt">
            <div className="stat">
              <div className="label">SKUs</div>
              <div className="value">{lines.length}</div>
            </div>
            <div className="stat">
              <div className="label">Received</div>
              <div className="value">{totals.received}</div>
            </div>
            <div className="stat">
              <div className="label">Variance</div>
              <div className="value" style={{ color: totals.expected - totals.received === 0 ? 'var(--ok)' : 'var(--warn)' }}>
                {totals.expected - totals.received}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Line ledger */}
      <div className="card mt">
        <div className="card-head">
          <h3>Line items</h3>
          <span className="muted">+1 for a manual increment · Override to correct a count (audited)</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th className="num">Variance</th>
                <th style={{ width: 140 }}>Progress</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={flashSku === l.itemSku ? 'flash' : ''}>
                  <td>
                    <div className="name">{l.itemName}</div>
                    <div className="sku mono">{l.itemSku}</div>
                  </td>
                  <td className="num">{l.expectedQuantity}</td>
                  <td className="num">{l.receivedQuantity}</td>
                  <td className="num">
                    <VarianceBadge variance={l.variance} />
                  </td>
                  <td>
                    <ProgressBar value={l.receivedQuantity} max={l.expectedQuantity} />
                  </td>
                  <td>
                    {edit?.lineId === l.id ? (
                      <div className="inline" style={{ gap: 6 }}>
                        <input
                          className="input"
                          style={{ width: 70 }}
                          type="number"
                          min={0}
                          value={edit.qty}
                          onChange={(e) => setEdit({ ...edit, qty: e.target.value })}
                        />
                        <input
                          className="input"
                          style={{ width: 110 }}
                          placeholder="reason"
                          value={edit.reason}
                          onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                        />
                        <button className="btn btn-primary" onClick={submitOverride}>
                          ✓
                        </button>
                        <button className="btn btn-ghost" onClick={() => setEdit(null)}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="btn-row">
                        <button className="btn" onClick={() => handleScan(l.itemSku, 'MANUAL_INCREMENT')}>
                          +1
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setEdit({ lineId: l.id, qty: String(l.receivedQuantity), reason: '' })}
                        >
                          Override
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
