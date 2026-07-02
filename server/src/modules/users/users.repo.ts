import { db, tx } from '../../db/database.ts';
import type { Role, UserRow } from '../../types.ts';

const selectAll = db.prepare('SELECT * FROM users ORDER BY created_at ASC');
const selectById = db.prepare('SELECT * FROM users WHERE id = ?');
const selectByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insert = db.prepare(
  'INSERT INTO users (email, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
);
const updateActive = db.prepare('UPDATE users SET is_active = ? WHERE id = ?');
const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const deleteUserWarehouses = db.prepare('DELETE FROM user_warehouses WHERE user_id = ?');
const insertUserWarehouse = db.prepare(
  'INSERT OR IGNORE INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)',
);

export function listUsers(): UserRow[] {
  return selectAll.all() as unknown as UserRow[];
}

export function getUserById(id: number): UserRow | undefined {
  return selectById.get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return selectByEmail.get(email) as UserRow | undefined;
}

export function createUser(input: {
  email: string;
  username: string;
  passwordHash: string;
  role: Role;
  isActive?: boolean;
}): UserRow {
  const info = insert.run(
    input.email,
    input.username,
    input.passwordHash,
    input.role,
    input.isActive === false ? 0 : 1,
  );
  return getUserById(Number(info.lastInsertRowid))!;
}

export function setUserActive(id: number, active: boolean): void {
  updateActive.run(active ? 1 : 0, id);
}

export function setUserPassword(id: number, passwordHash: string): void {
  updatePassword.run(passwordHash, id);
}

/** Replace a user's full warehouse mapping set atomically. */
export function setUserWarehouses(userId: number, warehouseIds: number[]): void {
  tx(() => {
    deleteUserWarehouses.run(userId);
    for (const wid of warehouseIds) insertUserWarehouse.run(userId, wid);
  });
}
