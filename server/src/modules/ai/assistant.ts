import { config } from '../../config.ts';
import { getReconciliationRows } from '../reports/reports.repo.ts';
import type { ReconciliationFilter } from '../reports/reports.repo.ts';
import { buildSummary } from '../reports/reports.service.ts';
import type { ReportSummary } from '../reports/reports.service.ts';
import { aiEnabled, completeText } from './ai.client.ts';

// Grounded operations assistant. Answers are generated strictly from the current
// reconciliation dataset (a retrieval-augmented pattern: we retrieve the summary
// + relevant rows from SQLite and feed them as context). Falls back cleanly to
// the deterministic summary when no Gemini key is configured.

const MAX_CONTEXT_LINES = 150;

function compactRows(filter: ReconciliationFilter) {
  const rows = getReconciliationRows(filter);
  const summary = buildSummary(rows);
  const sample = rows.slice(0, MAX_CONTEXT_LINES).map((r) => ({
    invoice: r.invoice_id,
    vendor: r.vendor_name,
    warehouse: r.warehouse_code,
    sku: r.item_sku,
    item: r.item_name,
    expected: r.expected_quantity,
    received: r.received_quantity,
    variance: r.variance,
    status: r.status,
    date: r.created_at.slice(0, 10),
  }));
  return { rows, summary, sample };
}

export interface AssistantAnswer {
  aiEnabled: boolean;
  grounded: boolean;
  answer: string;
  summary: ReportSummary;
}

export async function answerQuestion(
  question: string,
  filter: ReconciliationFilter,
): Promise<AssistantAnswer> {
  const { summary, sample } = compactRows(filter);

  if (!aiEnabled()) {
    return {
      aiEnabled: false,
      grounded: false,
      answer:
        'The AI assistant is not configured. Set GEMINI_API_KEY on the server to enable natural-language answers. The reconciliation summary and reports remain fully available.',
      summary,
    };
  }

  const system =
    "You are FreshTrack's inbound-receiving operations analyst. Answer ONLY from the provided reconciliation JSON. " +
    'Variance = Expected − Received (positive = shortfall / missing units, negative = overage). ' +
    'Be concise and specific: cite invoice IDs, SKUs, vendors, warehouses, and exact numbers. ' +
    'If the data does not contain the answer, say so plainly rather than guessing.';
  const user = `RECONCILIATION_DATA:\n${JSON.stringify({ summary, sample_lines: sample })}\n\nQUESTION: ${question}`;

  const answer = await completeText({ model: config.ai.assistantModel, system, user, maxTokens: 1024 });
  if (!answer) {
    return {
      aiEnabled: true,
      grounded: false,
      answer: 'The AI assistant is temporarily unavailable. Please try again shortly.',
      summary,
    };
  }
  return { aiEnabled: true, grounded: true, answer, summary };
}

export interface InsightsResult {
  aiEnabled: boolean;
  insights: string | null;
  summary: ReportSummary;
}

export async function generateInsights(filter: ReconciliationFilter): Promise<InsightsResult> {
  const { summary } = compactRows(filter);
  if (!aiEnabled()) return { aiEnabled: false, insights: null, summary };

  const system =
    "You are FreshTrack's receiving-operations analyst. From the reconciliation summary, write 3-5 short, actionable bullet points: " +
    'call out overall fill rate, the vendors/warehouses with the largest variances, and any invoices needing attention. ' +
    'Ground every claim strictly in the numbers provided. Return plain bullets, no preamble.';
  const user = JSON.stringify({ summary, top_variances: summary.topVariances });

  const insights = await completeText({ model: config.ai.assistantModel, system, user, maxTokens: 700 });
  return { aiEnabled: true, insights, summary };
}
