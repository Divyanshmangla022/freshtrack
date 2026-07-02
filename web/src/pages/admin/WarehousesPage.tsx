import { useState, useEffect } from 'react'
import { api, ApiError } from '../../api/client'
import { useToast } from '../../components/Toast'
import type { Warehouse } from '../../api/types'

type EditState = { id: number; name: string; location: string; isActive: boolean }

export function WarehousesPage() {
  const toast = useToast()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api.get<{ warehouses: Warehouse[] }>('/warehouses')
      setWarehouses(res.warehouses)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function createWarehouse() {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required')
      return
    }
    setBusy(true)
    try {
      await api.post<{ warehouse: Warehouse }>('/warehouses', {
        code: code.trim(),
        name: name.trim(),
        location: location.trim() || undefined,
      })
      toast.success('Warehouse added')
      setCode('')
      setName('')
      setLocation('')
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!edit) return
    setBusy(true)
    try {
      await api.patch<{ warehouse: Warehouse }>('/warehouses/' + edit.id, {
        name: edit.name,
        location: edit.location || null,
        isActive: edit.isActive,
      })
      toast.success('Warehouse updated')
      setEdit(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='container'>
      <div className='card'>
        <div className='card-head'>
          <h2>Add warehouse</h2>
        </div>
        <div className='grid cols-3'>
          <div className='field'>
            <label className='label'>Code</label>
            <input
              className='input'
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder='WH-001'
            />
          </div>
          <div className='field'>
            <label className='label'>Name</label>
            <input
              className='input'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Central Hub'
            />
          </div>
          <div className='field'>
            <label className='label'>Location</label>
            <input
              className='input'
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder='Optional'
            />
          </div>
        </div>
        <div className='btn-row mt'>
          <button className='btn btn-primary' disabled={busy} onClick={createWarehouse}>
            {busy ? <span className='spin' /> : 'Add warehouse'}
          </button>
        </div>
      </div>

      <div className='card'>
        <div className='card-head'>
          <h2>Warehouses</h2>
        </div>
        {loading ? (
          <div className='loading'>
            <span className='spin' />
          </div>
        ) : warehouses.length === 0 ? (
          <p className='muted'>No warehouses yet.</p>
        ) : (
          <div className='table-wrap'>
            <table className='table'>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) =>
                  edit && edit.id === w.id ? (
                    <tr key={w.id}>
                      <td className='mono'>{w.code}</td>
                      <td>
                        <input
                          className='input'
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className='input'
                          value={edit.location}
                          onChange={(e) => setEdit({ ...edit, location: e.target.value })}
                        />
                      </td>
                      <td>
                        <label className='checkbox'>
                          <input
                            type='checkbox'
                            checked={edit.isActive}
                            onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })}
                          />
                          Active
                        </label>
                      </td>
                      <td>
                        <div className='btn-row'>
                          <button className='btn btn-primary' disabled={busy} onClick={saveEdit}>
                            {busy ? <span className='spin' /> : 'Save'}
                          </button>
                          <button
                            className='btn btn-ghost'
                            disabled={busy}
                            onClick={() => setEdit(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={w.id}>
                      <td className='mono'>{w.code}</td>
                      <td>{w.name}</td>
                      <td>{w.location ? w.location : <span className='muted'>-</span>}</td>
                      <td>
                        {w.isActive ? (
                          <span className='badge badge-ok'>Active</span>
                        ) : (
                          <span className='badge badge-neutral'>Inactive</span>
                        )}
                      </td>
                      <td>
                        <button
                          className='btn btn-ghost'
                          onClick={() =>
                            setEdit({
                              id: w.id,
                              name: w.name,
                              location: w.location ?? '',
                              isActive: w.isActive,
                            })
                          }
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
