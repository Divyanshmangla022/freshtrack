import { useState, useEffect } from 'react'
import { api, ApiError } from '../../api/client'
import { useToast } from '../../components/Toast'
import type { User, Warehouse } from '../../api/types'

type Role = 'CENTRAL_ADMIN' | 'HUB_USER'

interface CreateForm {
  email: string
  username: string
  password: string
  role: Role
  warehouseIds: number[]
}

interface MappingEdit {
  userId: number
  warehouseIds: number[]
}

const emptyForm: CreateForm = {
  email: '',
  username: '',
  password: '',
  role: 'CENTRAL_ADMIN',
  warehouseIds: [],
}

export function UsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [mappingEdit, setMappingEdit] = useState<MappingEdit | null>(null)
  const [creating, setCreating] = useState(false)
  const [savingMapping, setSavingMapping] = useState(false)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [usersRes, whRes] = await Promise.all([
        api.get<{ users: User[] }>('/users'),
        api.get<{ warehouses: Warehouse[] }>('/warehouses'),
      ])
      setUsers(usersRes.users)
      setWarehouses(whRes.warehouses)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function reloadUsers() {
    try {
      const usersRes = await api.get<{ users: User[] }>('/users')
      setUsers(usersRes.users)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    }
  }

  function toggleFormWarehouse(id: number) {
    setForm((prev) => {
      const has = prev.warehouseIds.includes(id)
      return {
        ...prev,
        warehouseIds: has
          ? prev.warehouseIds.filter((w) => w !== id)
          : [...prev.warehouseIds, id],
      }
    })
  }

  function toggleMappingWarehouse(id: number) {
    setMappingEdit((prev) => {
      if (!prev) return prev
      const has = prev.warehouseIds.includes(id)
      return {
        ...prev,
        warehouseIds: has
          ? prev.warehouseIds.filter((w) => w !== id)
          : [...prev.warehouseIds, id],
      }
    })
  }

  async function handleCreate() {
    setCreating(true)
    try {
      await api.post<{ user: User }>('/users', {
        email: form.email,
        username: form.username,
        password: form.password,
        role: form.role,
        warehouseIds: form.role === 'HUB_USER' ? form.warehouseIds : undefined,
      })
      toast.success('User created')
      setForm(emptyForm)
      await reloadUsers()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(u: User) {
    setBusyUserId(u.id)
    try {
      await api.patch<{ user: User }>('/users/' + u.id, { isActive: !u.isActive })
      toast.success(u.isActive ? 'User deactivated' : 'User activated')
      await reloadUsers()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusyUserId(null)
    }
  }

  async function resetPassword(u: User) {
    const p = window.prompt('New password (min 8 chars)')
    if (!p || p.length < 8) return
    setBusyUserId(u.id)
    try {
      await api.patch<{ user: User }>('/users/' + u.id, { password: p })
      toast.success('Password reset')
      await reloadUsers()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusyUserId(null)
    }
  }

  function openMapping(u: User) {
    setMappingEdit({
      userId: u.id,
      warehouseIds: (u.warehouses ?? []).map((w) => w.id),
    })
  }

  async function saveMapping() {
    if (!mappingEdit) return
    setSavingMapping(true)
    try {
      await api.put<{ user: User }>('/users/' + mappingEdit.userId + '/warehouses', {
        warehouseIds: mappingEdit.warehouseIds,
      })
      toast.success('Warehouse mapping updated')
      setMappingEdit(null)
      await reloadUsers()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setSavingMapping(false)
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <span className="spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="card">
        <div className="card-head">
          <h2>Create User</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          <div className="grid cols-2">
            <div className="field">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label className="label">Username</label>
              <input
                className="input"
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label className="label">Role</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as Role })
                }
              >
                <option value="CENTRAL_ADMIN">Central Admin</option>
                <option value="HUB_USER">Hub User</option>
              </select>
            </div>
          </div>

          {form.role === 'HUB_USER' && (
            <div className="field mt">
              <label className="label">Warehouses</label>
              {warehouses.length === 0 ? (
                <div className="muted">No warehouses available.</div>
              ) : (
                <div className="flex gap">
                  {warehouses.map((w) => (
                    <label key={w.id} className="checkbox">
                      <input
                        type="checkbox"
                        checked={form.warehouseIds.includes(w.id)}
                        onChange={() => toggleFormWarehouse(w.id)}
                      />
                      {w.code}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="btn-row mt">
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? <span className="spin" /> : 'Create User'}
            </button>
          </div>
        </form>
      </div>

      {mappingEdit && (
        <div className="card">
          <div className="card-head">
            <h2>Edit Warehouse Mapping</h2>
          </div>
          {warehouses.length === 0 ? (
            <div className="muted">No warehouses available.</div>
          ) : (
            <div className="flex gap">
              {warehouses.map((w) => (
                <label key={w.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={mappingEdit.warehouseIds.includes(w.id)}
                    onChange={() => toggleMappingWarehouse(w.id)}
                  />
                  {w.code}
                </label>
              ))}
            </div>
          )}
          <div className="btn-row mt">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void saveMapping()}
              disabled={savingMapping}
            >
              {savingMapping ? <span className="spin" /> : 'Save'}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setMappingEdit(null)}
              disabled={savingMapping}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Users</h2>
        </div>
        {users.length === 0 ? (
          <div className="muted">No users found.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Warehouses</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const busy = busyUserId === u.id
                  return (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.email}</td>
                      <td>{u.role === 'CENTRAL_ADMIN' ? 'Central Admin' : 'Hub User'}</td>
                      <td>
                        {u.isActive ? (
                          <span className="badge badge-ok">Active</span>
                        ) : (
                          <span className="badge badge-neutral">Inactive</span>
                        )}
                      </td>
                      <td>
                        {u.role === 'HUB_USER' ? (
                          <span className="flex items-center gap">
                            <span>
                              {(u.warehouses ?? []).map((w) => w.code).join(', ') || '-'}
                            </span>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => openMapping(u)}
                            >
                              Edit
                            </button>
                          </span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        <div className="btn-row">
                          <button
                            className="btn"
                            type="button"
                            onClick={() => void toggleActive(u)}
                            disabled={busy}
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => void resetPassword(u)}
                            disabled={busy}
                          >
                            Reset password
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
