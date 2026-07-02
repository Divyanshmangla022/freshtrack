import { config } from '../../config.ts';

// ---------------------------------------------------------------------------
// Thin wrapper around the Google Gemini SDK (@google/genai). The SDK is imported
// lazily so the app runs fine when the dependency is absent or GEMINI_API_KEY is
// unset - every AI feature degrades to a deterministic fallback. Model IDs come
// from config so the operator can pick the exact Gemini model per environment.
// ---------------------------------------------------------------------------

type GenAIResponse = {
  text?: string;
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
};
type GenAIModels = {
  generateContent: (params: {
    model: string;
    contents: string;
    config?: Record<string, unknown>;
  }) => Promise<GenAIResponse>;
};
type GenAIClient = { models: GenAIModels };

let clientPromise: Promise<GenAIClient | null> | null = null;

export function aiEnabled(): boolean {
  return config.ai.enabled;
}

/** True only if the SDK actually loaded and a client is constructed. */
export async function aiReady(): Promise<boolean> {
  return (await getClient()) !== null;
}

function diagnostics(res: GenAIResponse): { blocked?: string; finish?: string } {
  return { blocked: res.promptFeedback?.blockReason, finish: res.candidates?.[0]?.finishReason };
}

async function getClient(): Promise<GenAIClient | null> {
  if (!config.ai.enabled) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        // Specifier cast to string so TypeScript does not statically require the
        // optional dependency's types; resolved at runtime only when present.
        const spec = '@google/genai';
        const mod = (await import(spec)) as {
          GoogleGenAI: new (opts: { apiKey: string }) => GenAIClient;
        };
        return new mod.GoogleGenAI({ apiKey: config.ai.apiKey as string });
      } catch (err) {
        console.warn('[ai] @google/genai unavailable - AI features disabled:', (err as Error).message);
        return null;
      }
    })();
  }
  return clientPromise;
}

/**
 * Plain-text completion. Returns null when AI is unavailable or the call fails -
 * callers treat null as "fall back to the deterministic path".
 */
export async function completeText(params: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const res = await client.models.generateContent({
      model: params.model,
      contents: params.user,
      config: {
        systemInstruction: params.system,
        maxOutputTokens: params.maxTokens ?? 1024,
        temperature: 0.2,
      },
    });
    const { blocked, finish } = diagnostics(res);
    if (blocked) {
      console.warn('[ai] text response blocked:', blocked);
      return null;
    }
    // Treat empty / whitespace-only output as "no answer" so callers fall back.
    const text = res.text;
    if (!text || !text.trim()) {
      if (finish === 'MAX_TOKENS') console.warn('[ai] text truncated (MAX_TOKENS) - consider raising maxTokens');
      return null;
    }
    return text;
  } catch (err) {
    console.warn('[ai] text completion failed:', (err as Error).message);
    return null;
  }
}

/**
 * JSON completion. Uses the backend's structured-output mode: `responseJsonSchema`
 * makes the model emit JSON that conforms to `schema` (not just a prose request),
 * with `responseMimeType` set to application/json. Thinking is disabled because
 * this is a fast, deterministic extraction task. JSON.parse + fence-stripping
 * remain as a defensive fallback. Returns null on any failure.
 */
export async function completeJSON<T>(params: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const res = await client.models.generateContent({
      model: params.model,
      contents: params.user,
      config: {
        systemInstruction: `${params.system}\n\nReturn ONLY a JSON value conforming to the schema - no prose, no code fences.`,
        maxOutputTokens: params.maxTokens ?? 1024,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: params.schema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const { blocked, finish } = diagnostics(res);
    if (blocked) {
      console.warn('[ai] JSON response blocked:', blocked);
      return null;
    }
    const text = res.text;
    if (!text) {
      if (finish === 'MAX_TOKENS') console.warn('[ai] JSON truncated (MAX_TOKENS) - consider raising maxTokens');
      return null;
    }
    return JSON.parse(stripFences(text)) as T;
  } catch (err) {
    console.warn('[ai] JSON completion failed:', (err as Error).message);
    return null;
  }
}

/** Remove ```json ... ``` fences a model may add despite instructions. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}
