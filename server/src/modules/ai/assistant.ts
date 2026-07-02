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
  // Rank by absolute variance so the most decision-relevant lines survive the cap
  // (rather than an arbitrary alphabetical prefix).
  const ordered = [...rows].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  const sample = ordered.slice(0, MAX_CONTEXT_LINES).map((r) => ({
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
  return { rows, summary, sample, totalLines: rows.length, partial: rows.length > sample.length };
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
  const { summary, sample, totalLines, partial } = compactRows(filter);

  if (!aiEnabled()) {
    return {
      aiEnabled: false,
      grounded: false,
      answer:
        'The AI assistant is not configured. Set GEMINI_API_KEY on the server to enable natural-language answers. The reconciliation summary and reports remain fully available.',
      summary,
    };
  }

  if (totalLines === 0) {
    return { aiEnabled: true, grounded: true, answer: 'No reconciliation data matches the selected filter.', summary };
  }

  const system =
    "You are FreshTrack's inbound-receiving operations analyst. Answer ONLY from the provided reconciliation JSON. " +
    'Variance = Expected - Received (positive = shortfall / missing units, negative = overage). ' +
    'Be concise and specific: cite invoice IDs, SKUs, vendors, warehouses, and exact numbers. ' +
    'The sample_lines array may be a partial, variance-ranked subset (see sample_is_partial and total_lines). ' +
    'For counts or exhaustive lists, rely on the summary totals; if a full row-level enumeration is requested while sample_is_partial is true, state that only a subset of rows is shown and give the summary figures instead. ' +
    'If the data does not contain the answer, say so plainly rather than guessing.';
  const user = `RECONCILIATION_DATA:\n${JSON.stringify({
    summary,
    total_lines: totalLines,
    sample_line_count: sample.length,
    sample_is_partial: partial,
    sample_lines: sample,
  })}\n\nQUESTION: ${question}`;

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
  if (summary.totals.lines === 0) {
    return { aiEnabled: true, insights: 'No reconciliation data for the selected filter.', summary };
  }

  const system =
    "You are FreshTrack's receiving-operations analyst. From the reconciliation summary, write 3-5 short, actionable bullet points: " +
    'call out overall fill rate, the vendors/warehouses with the largest variances, and any invoices needing attention. ' +
    'Ground every claim strictly in the numbers provided; if a metric is not present in the data, do not speculate - say there is insufficient data for that point. ' +
    'Return plain bullets, no preamble.';
  const user = JSON.stringify({ summary });

  const insights = await completeText({ model: config.ai.assistantModel, system, user, maxTokens: 700 });
  return { aiEnabled: true, insights, summary };
}
