import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { VarianceBadge } from '../../components/StatusBadge';
import type { AiStatus, ReportSummary } from '../../api/types';

export function AdminDashboard() {
  const toast = useToast();
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [insights, setInsights] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const [summaryRes, aiRes] = await Promise.all([
          api.get<{ summary: ReportSummary }>('/reports/summary'),
          api.get<AiStatus>('/ai/status'),
        ]);
        if (!active) return;
        setSummary(summaryRes.summary);
        setAiStatus(aiRes);
      } catch (e) {
        if (!active) return;
        setError(true);
        toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function generateInsights() {
    setGenerating(true);
    try {
      const res = await api.post<{ aiEnabled: boolean; insights: string | null; summary: ReportSummary }>(
        '/ai/insights',
        {},
      );
      setInsights(res.insights);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <span className="spin" />
        </div>
      </div>
    );
  }

  if (error || !summary || !aiStatus) {
    return (
      <div className="container">
        <div className="alert alert-error">Failed to load the dashboard. Please try again.</div>
      </div>
    );
  }

  const t = summary.totals;

  return (
    <div className="container">
      <h1>Operations dashboard</h1>
      <p className="muted">Cross-warehouse operations overview.</p>

      <div className="grid cols-4">
        <div className="stat">
          <div className="label">Invoices</div>
          <div className="value">{t.invoices}</div>
        </div>
        <div className="stat">
          <div className="label">Fill rate</div>
          <div className="value">{Math.round(t.fillRate * 100) + '%'}</div>
        </div>
        <div className="stat">
          <div className="label">Units received</div>
          <div className="value">{t.received}</div>
          <div className="sub">of {t.expected} expected</div>
        </div>
        <div className="stat">
          <div className="label">Total variance</div>
          <div className="value" style={{ color: t.variance === 0 ? 'var(--ok)' : 'var(--warn)' }}>
            {t.variance}
          </div>
        </div>
        <div className="stat">
          <div className="label">Completed invoices</div>
          <div className="value">{t.completedInvoices}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">Variance by warehouse</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th className="num">Invoices</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {summary.byWarehouse.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="num">{g.invoices}</td>
                  <td className="num">{g.expected}</td>
                  <td className="num">{g.received}</td>
                  <td className="num">
                    <VarianceBadge variance={g.variance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">Variance by vendor</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="num">Invoices</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {summary.byVendor.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="num">{g.invoices}</td>
                  <td className="num">{g.expected}</td>
                  <td className="num">{g.received}</td>
                  <td className="num">
                    <VarianceBadge variance={g.variance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">Largest variances</div>
        {summary.topVariances.length === 0 ? (
          <p className="muted">No variances - everything is reconciled.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Warehouse</th>
                  <th className="num">Expected</th>
                  <th className="num">Received</th>
                  <th className="num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {summary.topVariances.map((r, i) => (
                  <tr key={`${r.invoiceId}-${r.itemSku}-${i}`}>
                    <td>{r.invoiceId}</td>
                    <td className="mono">{r.itemSku}</td>
                    <td>{r.itemName}</td>
                    <td>{r.warehouseCode}</td>
                    <td className="num">{r.expectedQuantity}</td>
                    <td className="num">{r.receivedQuantity}</td>
                    <td className="num">
                      <VarianceBadge variance={r.variance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">AI insights</div>
        {aiStatus.enabled ? (
          <div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={generateInsights} disabled={generating}>
                {generating ? <span className="spin" /> : 'Generate insights'}
              </button>
            </div>
            {insights !== null && (
              <p className="mt" style={{ whiteSpace: 'pre-wrap' }}>
                {insights}
              </p>
            )}
          </div>
        ) : (
          <div className="alert alert-info">
            Set GEMINI_API_KEY on the server to enable AI-generated insights and the reconciliation
            assistant.
          </div>
        )}
      </div>
    </div>
  );
}
