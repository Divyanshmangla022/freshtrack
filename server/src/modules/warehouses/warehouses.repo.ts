import { db } from '../../db/database.ts';
import type { WarehouseRow } from '../../types.ts';

const selectAll = db.prepare('SELECT * FROM warehouses ORDER BY code ASC');
const selectById = db.prepare('SELECT * FROM warehouses WHERE id = ?');
const selectByCode = db.prepare('SELECT * FROM warehouses WHERE code = ?');
const insert = db.prepare(
  'INSERT INTO warehouses (code, name, location, is_active) VALUES (?, ?, ?, ?)',
);
const update = db.prepare(
  'UPDATE warehouses SET name = ?, location = ?, is_active = ? WHERE id = ?',
);
const selectForUser = db.prepare(
  `SELECT w.* FROM warehouses w
   JOIN user_warehouses uw ON uw.warehouse_id = w.id
   WHERE uw.user_id = ?
   ORDER BY w.code ASC`,
);
const mappingExists = db.prepare(
  'SELECT 1 AS ok FROM user_warehouses WHERE user_id = ? AND warehouse_id = ?',
);

export function listWarehouses(): WarehouseRow[] {
  return selectAll.all() as unknown as WarehouseRow[];
}

export function getWarehouseById(id: number): WarehouseRow | undefined {
  return selectById.get(id) as WarehouseRow | undefined;
}

export function getWarehouseByCode(code: string): WarehouseRow | undefined {
  return selectByCode.get(code) as WarehouseRow | undefined;
}

export function createWarehouse(input: {
  code: string;
  name: string;
  location?: string | null;
  isActive?: boolean;
}): WarehouseRow {
  const info = insert.run(
    input.code,
    input.name,
    input.location ?? null,
    input.isActive === false ? 0 : 1,
  );
  return getWarehouseById(Number(info.lastInsertRowid))!;
}

export function updateWarehouse(
  id: number,
  input: { name: string; location?: string | null; isActive: boolean },
): WarehouseRow | undefined {
  update.run(input.name, input.location ?? null, input.isActive ? 1 : 0, id);
  return getWarehouseById(id);
}

export function listWarehousesForUser(userId: number): WarehouseRow[] {
  return selectForUser.all(userId) as unknown as WarehouseRow[];
}

export function isUserMappedToWarehouse(userId: number, warehouseId: number): boolean {
  return mappingExists.get(userId, warehouseId) !== undefined;
}
