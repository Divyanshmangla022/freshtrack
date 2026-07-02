import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Warehouse } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';

export function WarehouseSelectPage() {
  const { selectWarehouse, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ warehouses: Warehouse[] }>('/warehouses')
      .then((r) => setWarehouses(r.warehouses))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load warehouses'))
      .finally(() => setLoading(false));
  }, [toast]);

  const choose = async (w: Warehouse) => {
    setBusyId(w.id);
    try {
      await selectWarehouse(w.id);
      navigate('/hub', { replace: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not enter warehouse');
      setBusyId(null);
    }
  };

  return (
    <div className="container narrow">
      <div className="flex between items-center mb">
        <h1>Select your warehouse</h1>
        <button className="btn btn-ghost" onClick={() => logout().then(() => navigate('/login'))}>
          Sign out
        </button>
      </div>
      <p className="muted">Choose the physical dock you are receiving at. You will only see and scan invoices for this warehouse.</p>

      {loading ? (
        <div className="loading">
          <span className="spin" />
        </div>
      ) : warehouses.length === 0 ? (
        <div className="alert alert-warn">You are not assigned to any warehouse. Ask a Central Admin to map you.</div>
      ) : (
        <div className="grid cols-2 mt">
          {warehouses.map((w) => (
            <button key={w.id} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => choose(w)} disabled={busyId !== null}>
              <div className="flex between items-center">
                <h2 style={{ margin: 0 }}>{w.code}</h2>
                {busyId === w.id ? <span className="spin" /> : <span className="badge badge-neutral">Enter</span>}
              </div>
              <div className="dim">{w.name}</div>
              {w.location && <div className="muted" style={{ fontSize: '0.85rem' }}>{w.location}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
