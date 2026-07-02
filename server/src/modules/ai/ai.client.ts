import { config } from '../../config.ts';

// ---------------------------------------------------------------------------
// Thin wrapper around the Google Gemini SDK (@google/genai). The SDK is imported
// lazily so the app runs fine when the dependency is absent or GEMINI_API_KEY is
// unset - every AI feature degrades to a deterministic fallback. Model IDs come
// from config so the operator can pick the exact Gemini model per environment.
// ---------------------------------------------------------------------------

type GenAIResponse = { text?: string };
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
    // Treat empty / whitespace-only output (safety blocks, truncation, empty
    // candidates) as "no answer" so callers fall back instead of showing "".
    const text = res.text;
    return text && text.trim() ? text : null;
  } catch (err) {
    console.warn('[ai] text completion failed:', (err as Error).message);
    return null;
  }
}

/**
 * JSON completion. Asks Gemini for JSON (responseMimeType application/json) and
 * parses it. `schema` is embedded in the prompt as a shape hint - kept provider-
 * agnostic so we don't depend on a specific SDK's schema dialect. Returns null
 * on any failure.
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
    const system = `${params.system}\n\nRespond with ONLY valid JSON matching this JSON Schema (no prose, no code fences):\n${JSON.stringify(params.schema)}`;
    const res = await client.models.generateContent({
      model: params.model,
      contents: params.user,
      config: {
        systemInstruction: system,
        maxOutputTokens: params.maxTokens ?? 1024,
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });
    const text = res.text;
    if (!text) return null;
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
