import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { InvoiceSummary } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';

export function HubInvoicesPage() {
  const { activeWarehouse } = useAuth();
  const toast = useToast();
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ invoices: InvoiceSummary[] }>('/invoices')
      .then((r) => setInvoices(r.invoices))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load invoices'))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className="container">
      <div className="flex between items-center mb">
        <div>
          <h1>Inbound invoices</h1>
          <p className="muted">Active dock: {activeWarehouse?.code} - {activeWarehouse?.name}. Select an invoice being unloaded to begin scanning.</p>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spin" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="card">No invoices are currently expected at this warehouse.</div>
      ) : (
        <div className="grid cols-2">
          {invoices.map((inv) => (
            <Link key={inv.id} to={`/hub/scan/${inv.id}`} className="card" style={{ display: 'block' }}>
              <div className="flex between items-center">
                <h2 style={{ margin: 0 }}>{inv.invoiceId}</h2>
                <StatusBadge status={inv.status} />
              </div>
              <div className="dim">{inv.vendorName}</div>
              <div className="flex between mt" style={{ fontSize: '0.85rem' }}>
                <span className="muted">{inv.lineCount} SKUs</span>
                <span className="mono">
                  {inv.totalReceived} / {inv.totalExpected} units
                </span>
              </div>
              <div className="mt">
                <ProgressBar value={inv.totalReceived} max={inv.totalExpected} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
