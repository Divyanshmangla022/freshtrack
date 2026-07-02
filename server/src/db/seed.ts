import { config } from '../config.ts';
import './database.ts'; // opens the DB and runs migrations
import { ROLES } from '../types.ts';
import { hashPassword } from '../modules/auth/auth.service.ts';
import { createUser, getUserByEmail, setUserWarehouses } from '../modules/users/users.repo.ts';
import { createWarehouse, getWarehouseByCode } from '../modules/warehouses/warehouses.repo.ts';
import { createInvoices, getInvoiceByBusinessId } from '../modules/invoices/invoices.repo.ts';
import type { Role } from '../types.ts';

const WAREHOUSES = [
  { code: 'WH-NYC-01', name: 'New York Hub', location: 'Brooklyn, NY' },
  { code: 'WH-CHI-01', name: 'Chicago Hub', location: 'Chicago, IL' },
  { code: 'WH-LAX-01', name: 'Los Angeles Hub', location: 'Vernon, CA' },
];

interface SeedInvoice {
  invoiceId: string;
  vendorName: string;
  warehouseCode: string;
  lines: Array<{ itemSku: string; itemName: string; expectedQuantity: number }>;
}

const INVOICES: SeedInvoice[] = [
  {
    invoiceId: 'INV-1001',
    vendorName: 'Green Valley Farms',
    warehouseCode: 'WH-NYC-01',
    lines: [
      { itemSku: 'APL-FUJI-001', itemName: 'Fuji Apple', expectedQuantity: 120 },
      { itemSku: 'BAN-CAV-002', itemName: 'Cavendish Banana', expectedQuantity: 240 },
      { itemSku: 'ORG-NAV-003', itemName: 'Navel Orange', expectedQuantity: 90 },
      { itemSku: 'GRP-RED-004', itemName: 'Red Seedless Grapes', expectedQuantity: 60 },
      { itemSku: 'STR-PNT-005', itemName: 'Strawberry Pint', expectedQuantity: 48 },
    ],
  },
  {
    invoiceId: 'INV-1002',
    vendorName: 'Sunrise Produce Co',
    warehouseCode: 'WH-NYC-01',
    lines: [
      { itemSku: 'TOM-ROM-101', itemName: 'Roma Tomato', expectedQuantity: 150 },
      { itemSku: 'LET-ROM-102', itemName: 'Romaine Lettuce', expectedQuantity: 80 },
      { itemSku: 'CUC-ENG-103', itemName: 'English Cucumber', expectedQuantity: 100 },
      { itemSku: 'PEP-BEL-104', itemName: 'Bell Pepper (Red)', expectedQuantity: 75 },
    ],
  },
  {
    invoiceId: 'INV-2001',
    vendorName: 'Prairie Fresh Distributors',
    warehouseCode: 'WH-CHI-01',
    lines: [
      { itemSku: 'POT-RUS-201', itemName: 'Russet Potato', expectedQuantity: 300 },
      { itemSku: 'ONI-YEL-202', itemName: 'Yellow Onion', expectedQuantity: 200 },
      { itemSku: 'CAR-BAG-203', itemName: 'Carrot 2lb Bag', expectedQuantity: 120 },
      { itemSku: 'BRO-CRW-204', itemName: 'Broccoli Crown', expectedQuantity: 90 },
    ],
  },
  {
    invoiceId: 'INV-3001',
    vendorName: 'Pacific Coast Growers',
    warehouseCode: 'WH-LAX-01',
    lines: [
      { itemSku: 'AVO-HASS-301', itemName: 'Hass Avocado', expectedQuantity: 180 },
      { itemSku: 'LEM-EUR-302', itemName: 'Eureka Lemon', expectedQuantity: 140 },
      { itemSku: 'LIM-PER-303', itemName: 'Persian Lime', expectedQuantity: 160 },
      { itemSku: 'SPI-BAG-304', itemName: 'Baby Spinach Bag', expectedQuantity: 70 },
      { itemSku: 'KAL-BUN-305', itemName: 'Kale Bunch', expectedQuantity: 55 },
    ],
  },
];

async function ensureUser(input: {
  email: string;
  username: string;
  password: string;
  role: Role;
  warehouseCodes: string[];
}): Promise<number> {
  const email = input.email.toLowerCase();
  const existing = getUserByEmail(email);
  if (existing) {
    console.log(`  · user ${email} already exists (id ${existing.id})`);
    return existing.id;
  }
  const passwordHash = await hashPassword(input.password);
  const user = createUser({ email, username: input.username, passwordHash, role: input.role });
  if (input.role === ROLES.HUB && input.warehouseCodes.length > 0) {
    const ids = input.warehouseCodes
      .map((code) => getWarehouseByCode(code)?.id)
      .filter((id): id is number => typeof id === 'number');
    setUserWarehouses(user.id, ids);
  }
  console.log(`  ✓ created user ${email} (${input.role})`);
  return user.id;
}

async function main(): Promise<void> {
  console.log('Seeding FreshTrack...');

  console.log('Warehouses:');
  for (const w of WAREHOUSES) {
    if (getWarehouseByCode(w.code)) {
      console.log(`  · ${w.code} already exists`);
    } else {
      createWarehouse(w);
      console.log(`  ✓ ${w.code} - ${w.name}`);
    }
  }

  console.log('Users:');
  const adminId = await ensureUser({
    email: config.seed.adminEmail,
    username: 'Central Admin',
    password: config.seed.adminPassword,
    role: ROLES.ADMIN,
    warehouseCodes: [],
  });
  await ensureUser({
    email: 'nyc.hub@freshtrack.io',
    username: 'NYC Dock Operator',
    password: config.seed.hubPassword,
    role: ROLES.HUB,
    warehouseCodes: ['WH-NYC-01'],
  });
  await ensureUser({
    email: 'chi.hub@freshtrack.io',
    username: 'Chicago Dock Operator',
    password: config.seed.hubPassword,
    role: ROLES.HUB,
    warehouseCodes: ['WH-CHI-01'],
  });
  await ensureUser({
    email: 'regional.hub@freshtrack.io',
    username: 'Regional Operator (NYC + CHI)',
    password: config.seed.hubPassword,
    role: ROLES.HUB,
    warehouseCodes: ['WH-NYC-01', 'WH-CHI-01'],
  });

  console.log('Invoices:');
  for (const inv of INVOICES) {
    if (getInvoiceByBusinessId(inv.invoiceId)) {
      console.log(`  · ${inv.invoiceId} already exists`);
      continue;
    }
    const warehouse = getWarehouseByCode(inv.warehouseCode);
    if (!warehouse) {
      console.warn(`  ! skipping ${inv.invoiceId} - warehouse ${inv.warehouseCode} missing`);
      continue;
    }
    createInvoices([
      {
        invoiceId: inv.invoiceId,
        vendorName: inv.vendorName,
        warehouseId: warehouse.id,
        uploadedBy: adminId,
        lines: inv.lines,
      },
    ]);
    console.log(`  ✓ ${inv.invoiceId} - ${inv.vendorName} (${inv.lines.length} lines)`);
  }

  console.log('\nSeed complete. Sign-in credentials:');
  console.log(`  Admin  -> ${config.seed.adminEmail} / ${config.seed.adminPassword}`);
  console.log(`  Hub    -> nyc.hub@freshtrack.io / ${config.seed.hubPassword}`);
  console.log(`  Hub    -> chi.hub@freshtrack.io / ${config.seed.hubPassword}`);
  console.log(`  Hub    -> regional.hub@freshtrack.io / ${config.seed.hubPassword}`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
