import { useState, useEffect } from 'react'
import { api, ApiError } from '../../api/client'
import { useToast } from '../../components/Toast'
import { StatusBadge, VarianceBadge } from '../../components/StatusBadge'
import type { Warehouse, ReconciliationResponse, AssistantAnswer } from '../../api/types'

interface Filter {
  dateFrom: string
  dateTo: string
  warehouseId: string
  vendor: string
  status: string
}

export function ReportsPage() {
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>({
    dateFrom: '',
    dateTo: '',
    warehouseId: '',
    vendor: '',
    status: '',
  })
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [data, setData] = useState<ReconciliationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const wRes = await api.get<{ warehouses: Warehouse[] }>('/warehouses')
        if (active) setWarehouses(wRes.warehouses)
        const status = await api.get<{ enabled: boolean }>('/ai/status')
        if (active) setAiEnabled(status.enabled)
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  function buildQuery(): string {
    const params = new URLSearchParams()
    if (filter.dateFrom) params.set('dateFrom', filter.dateFrom)
    if (filter.dateTo) params.set('dateTo', filter.dateTo)
    if (filter.warehouseId) params.set('warehouseId', filter.warehouseId)
    if (filter.vendor) params.set('vendor', filter.vendor)
    if (filter.status) params.set('status', filter.status)
    return params.toString()
  }

  async function runReport() {
    setLoading(true)
    try {
      const res = await api.get<ReconciliationResponse>('/reports/reconciliation?' + buildQuery())
      setData(res)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function exportReport(format: 'csv' | 'xlsx') {
    try {
      await api.download(
        '/reports/reconciliation/export?format=' + format + '&' + buildQuery(),
        format === 'csv' ? 'reconciliation.csv' : 'reconciliation.xlsx',
      )
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    }
  }

  async function ask() {
    if (!question.trim() || asking) return
    setAsking(true)
    try {
      const filterBody: Record<string, string | number> = {}
      if (filter.dateFrom) filterBody.dateFrom = filter.dateFrom
      if (filter.dateTo) filterBody.dateTo = filter.dateTo
      if (filter.warehouseId) filterBody.warehouseId = Number(filter.warehouseId)
      if (filter.vendor) filterBody.vendor = filter.vendor
      if (filter.status) filterBody.status = filter.status
      const res = await api.post<AssistantAnswer>('/ai/assistant', {
        question,
        filter: filterBody,
      })
      setAnswer(res)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setAsking(false)
    }
  }

  const totals = data?.summary.totals

  return (
    <div className="container">
      <div className="card">
        <div className="card-head">
          <h2>Reconciliation Report</h2>
        </div>
        <div className="inline">
          <div className="field">
            <label className="label">Date from</label>
            <input
              type="date"
              className="input"
              value={filter.dateFrom}
              onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label">Date to</label>
            <input
              type="date"
              className="input"
              value={filter.dateTo}
              onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label">Warehouse</label>
            <select
              className="input"
              value={filter.warehouseId}
              onChange={(e) => setFilter({ ...filter, warehouseId: e.target.value })}
            >
              <option value="">All</option>
              {warehouses.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Vendor</label>
            <input
              className="input"
              value={filter.vendor}
              onChange={(e) => setFilter({ ...filter, vendor: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label">Status</label>
            <select
              className="input"
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            >
              <option value="">All</option>
              <option value="OPEN">OPEN</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
        </div>
        <div className="btn-row mt">
          <button className="btn btn-primary" onClick={runReport} disabled={loading}>
            {loading ? <span className="spin" /> : 'Run report'}
          </button>
          <button className="btn" onClick={() => exportReport('csv')}>
            Export CSV
          </button>
          <button className="btn" onClick={() => exportReport('xlsx')}>
            Export Excel
          </button>
        </div>
      </div>

      {loading && (
        <div className="loading">
          <span className="spin" />
        </div>
      )}

      {data && totals && (
        <>
          <div className="grid cols-4 mt">
            <div className="stat">
              <div className="label">Invoices</div>
              <div className="value">{totals.invoices}</div>
            </div>
            <div className="stat">
              <div className="label">Fill rate</div>
              <div className="value">{Math.round(totals.fillRate * 100) + '%'}</div>
            </div>
            <div className="stat">
              <div className="label">Received</div>
              <div className="value">
                {totals.received} / {totals.expected}
              </div>
            </div>
            <div className="stat">
              <div className="label">Variance</div>
              <div className="value">{totals.variance}</div>
            </div>
            <div className="stat">
              <div className="label">Lines with variance</div>
              <div className="value">{totals.linesWithVariance}</div>
            </div>
          </div>

          <div className="card mt">
            <div className="card-head">
              <h3>Rows</h3>
              <span className="muted">{data.rows.length} lines</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice_ID</th>
                    <th>Vendor</th>
                    <th>Warehouse</th>
                    <th>Item_SKU</th>
                    <th>Item_Name</th>
                    <th className="num">Expected</th>
                    <th className="num">Received</th>
                    <th className="num">Variance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i}>
                      <td>{row.invoiceId}</td>
                      <td>{row.vendorName}</td>
                      <td>{row.warehouseCode}</td>
                      <td className="mono">{row.itemSku}</td>
                      <td>{row.itemName}</td>
                      <td className="num">{row.expectedQuantity}</td>
                      <td className="num">{row.receivedQuantity}</td>
                      <td className="num">
                        <VarianceBadge variance={row.variance} />
                      </td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="card mt">
        <div className="card-head">
          <h3>AI Assistant</h3>
        </div>
        {!aiEnabled && (
          <div className="alert alert-info">
            The AI assistant is disabled without a GEMINI_API_KEY. A computed summary message is
            still returned.
          </div>
        )}
        <div className="field">
          <textarea
            className="input"
            placeholder="Ask about the reconciliation data, e.g. which vendor has the largest shortfall?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={ask} disabled={!question.trim() || asking}>
            {asking ? <span className="spin" /> : 'Ask'}
          </button>
        </div>
        {answer && (
          <div className="mt" style={{ whiteSpace: 'pre-wrap' }}>
            {answer.answer}
          </div>
        )}
      </div>
    </div>
  )
}
