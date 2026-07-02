import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useToast } from '../../components/Toast'
import type { AuditEntry } from '../../api/types'

export function AuditPage() {
  const toast = useToast()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await api.get<{ entries: AuditEntry[] }>('/audit?limit=200')
      setEntries(res.entries)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="container">
      <div className="card">
        <div className="card-head between items-center">
          <div>
            <h1>Audit log</h1>
            <div className="muted">Recent activity across the FreshTrack admin console.</div>
          </div>
          <button className="btn" onClick={() => load()} disabled={loading}>
            {loading ? <span className="spin" /> : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="loading">
            <span className="spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="muted center mt">No audit entries yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                    <td>{e.actorUsername || e.actorEmail || 'system'}</td>
                    <td>
                      <span className="badge badge-neutral mono">{e.action}</span>
                    </td>
                    <td>
                      {e.entity ? e.entity + (e.entityId ? ' #' + e.entityId : '') : ''}
                    </td>
                    <td>
                      {e.metadata !== null ? (
                        <span className="mono dim">{JSON.stringify(e.metadata)}</span>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
