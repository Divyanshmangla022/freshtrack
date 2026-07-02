import { useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useToast } from '../../components/Toast'
import type { IngestResult } from '../../api/types'

export function InvoiceUploadPage() {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<IngestResult | null>(null)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [committing, setCommitting] = useState(false)

  async function handlePreview() {
    if (!file) return
    setPreviewing(true)
    try {
      const res = await api.upload<IngestResult>('/invoices/preview', file)
      setPreview(res)
      setResult(null)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleCommit() {
    if (!file) return
    setCommitting(true)
    try {
      const { data } = await api.uploadRaw<IngestResult>('/invoices/upload', file)
      setResult(data)
      if (data.committed) {
        toast.success('Created ' + data.createdInvoiceIds.length + ' invoice(s)')
      } else {
        toast.error('Upload rejected - see validation errors below')
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setCommitting(false)
    }
  }

  function renderReport(r: IngestResult) {
    const canonicalFields = Object.keys(r.mapping.matchedHeaders)
    return (
      <>
        <div className="card">
          <div className="card-head">
            <h2>Column mapping</h2>
            {r.mapping.aiUsed && <span className="badge badge-ok">AI-assisted mapping</span>}
          </div>
          <div className="muted mb">Method: {r.mapping.method}</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Canonical field</th>
                  <th>Matched header</th>
                </tr>
              </thead>
              <tbody>
                {canonicalFields.map((fieldKey) => {
                  const matched = r.mapping.matchedHeaders[fieldKey]
                  return (
                    <tr key={fieldKey}>
                      <td className="mono">{fieldKey}</td>
                      <td>
                        {matched != null ? (
                          matched
                        ) : (
                          <span className="badge badge-bad">unmatched</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="grid cols-3">
            <div className="stat">
              <div className="label">Total rows</div>
              <div className="value">{r.totalRows}</div>
            </div>
            <div className="stat">
              <div className="label">Valid rows</div>
              <div className="value">{r.validRows}</div>
            </div>
            <div className="stat">
              <div className="label">Invoices</div>
              <div className="value">{r.invoices.length}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Invoices</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice_ID</th>
                  <th>Vendor</th>
                  <th>Warehouse</th>
                  <th className="num">Lines</th>
                  <th className="num">Expected units</th>
                </tr>
              </thead>
              <tbody>
                {r.invoices.map((inv, idx) => (
                  <tr key={inv.invoiceId + '-' + idx}>
                    <td className="mono">{inv.invoiceId}</td>
                    <td>{inv.vendorName}</td>
                    <td>{inv.warehouseCode}</td>
                    <td className="num">{inv.lineCount}</td>
                    <td className="num">{inv.totalExpected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {r.errors.length > 0 && (
          <div className="alert alert-error">
            <ul>
              {r.errors.map((err, idx) => (
                <li key={idx}>
                  Row {err.row}: {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {r.committed && (
          <div className="alert alert-info">
            Committed {r.createdInvoiceIds.length} invoice(s).
          </div>
        )}
      </>
    )
  }

  const report = result ?? preview

  return (
    <div className="container">
      <h1>Upload invoices</h1>
      <p className="muted">
        Supported formats: CSV, XLSX, XLS. Columns are auto-mapped to Invoice_ID, Vendor_Name,
        Target_Warehouse_ID, Item_SKU, Item_Name, Expected_Quantity. Target_Warehouse_ID must
        already exist in the system.
      </p>

      <div className="card">
        <div className="field">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="input"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setPreview(null)
              setResult(null)
            }}
          />
        </div>
        <div className="btn-row">
          <button
            className="btn"
            disabled={!file || previewing}
            onClick={handlePreview}
          >
            {previewing && <span className="spin" />} Preview
          </button>
          <button
            className="btn btn-primary"
            disabled={!file || committing}
            onClick={handleCommit}
          >
            {committing && <span className="spin" />} Commit upload
          </button>
        </div>
      </div>

      {report && renderReport(report)}
    </div>
  )
}
