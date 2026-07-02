import { useState, useEffect, Fragment } from 'react';
import { api, ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { StatusBadge, VarianceBadge } from '../../components/StatusBadge';
import { ProgressBar } from '../../components/ProgressBar';
import type { InvoiceSummary, InvoiceDetail, Warehouse } from '../../api/types';

interface Filter {
  warehouseId: string;
  vendor: string;
  status: string;
}

export function InvoicesPage() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [filter, setFilter] = useState<Filter>({ warehouseId: '', vendor: '', status: '' });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, InvoiceDetail>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [wh, inv] = await Promise.all([
          api.get<{ warehouses: Warehouse[] }>('/warehouses'),
          api.get<{ invoices: InvoiceSummary[] }>('/invoices'),
        ]);
        if (cancelled) return;
        setWarehouses(wh.warehouses);
        setInvoices(inv.invoices);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function applyFilters() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.warehouseId) params.set('warehouseId', filter.warehouseId);
      if (filter.vendor) params.set('vendor', filter.vendor);
      if (filter.status) params.set('status', filter.status);
      const qs = params.toString();
      const inv = await api.get<{ invoices: InvoiceSummary[] }>('/invoices?' + qs);
      setInvoices(inv.invoices);
      setExpandedId(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function toggleRow(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      try {
        const res = await api.get<{ invoice: InvoiceDetail }>('/invoices/' + id);
        setDetails((prev) => ({ ...prev, [id]: res.invoice }));
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
      }
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="card-head">
          <h2>Invoices</h2>
        </div>
        <div className="inline">
          <div className="field">
            <label className="label">Warehouse</label>
            <select
              className="input"
              value={filter.warehouseId}
              onChange={(e) => setFilter((f) => ({ ...f, warehouseId: e.target.value }))}
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.code + ' - ' + w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Vendor</label>
            <input
              className="input"
              value={filter.vendor}
              onChange={(e) => setFilter((f) => ({ ...f, vendor: e.target.value }))}
            />
          </div>
          <div className="field">
            <label className="label">Status</label>
            <select
              className="input"
              value={filter.status}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">All</option>
              <option value="OPEN">OPEN</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
          <div className="field">
            <button className="btn btn-primary" onClick={() => void applyFilters()}>
              Apply filters
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">
            <span className="spin" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="muted">No invoices match the current filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Vendor</th>
                  <th>Warehouse</th>
                  <th>Status</th>
                  <th className="num">SKUs</th>
                  <th className="num">Received / Expected</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const detail = details[i.id];
                  const expanded = expandedId === i.id;
                  return (
                    <Fragment key={i.id}>
                      <tr className="clickable" onClick={() => void toggleRow(i.id)}>
                        <td>{i.invoiceId}</td>
                        <td>{i.vendorName}</td>
                        <td>{i.warehouseCode}</td>
                        <td>
                          <StatusBadge status={i.status} />
                        </td>
                        <td className="num">{i.lineCount}</td>
                        <td className="num">{i.totalReceived + ' / ' + i.totalExpected}</td>
                        <td>
                          <ProgressBar value={i.totalReceived} max={i.totalExpected} />
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={i.id + '-detail'}>
                          <td colSpan={7}>
                            {detail ? (
                              <div className="table-wrap">
                                <table className="table">
                                  <thead>
                                    <tr>
                                      <th>Item</th>
                                      <th>SKU</th>
                                      <th className="num">Expected</th>
                                      <th className="num">Received</th>
                                      <th>Variance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.lines.map((line) => (
                                      <tr key={line.id}>
                                        <td>{line.itemName}</td>
                                        <td className="mono">{line.itemSku}</td>
                                        <td className="num">{line.expectedQuantity}</td>
                                        <td className="num">{line.receivedQuantity}</td>
                                        <td>
                                          <VarianceBadge variance={line.variance} />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="loading">
                                <span className="spin" />
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
