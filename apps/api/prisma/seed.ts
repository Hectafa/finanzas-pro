/**
 * Seed: sincroniza permisos y roles de sistema. Con --demo crea además datos de demostración
 * claramente marcados (empresa con is_demo = true y correos @demo.finanzaspro.test).
 * Se ejecuta con DATABASE_MIGRATION_URL (rol dueño), nunca con el rol de la API.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth/passwords';
import { uuidv7 } from '../src/db/ids';
import { syncReferenceData } from '../src/db/reference-data';
import { PrismaClient } from '../src/generated/prisma/client';

const DEMO_COMPANY = 'Cafetería Demo (DATOS DE PRUEBA)';
const DEMO_USERS = [
  { email: 'propietario@demo.finanzaspro.test', fullName: 'Demo Propietario', role: 'OWNER' },
  { email: 'empleado@demo.finanzaspro.test', fullName: 'Demo Empleado', role: 'EMPLOYEE' },
] as const;

async function seedDemo(prisma: PrismaClient) {
  if (process.env.NODE_ENV === 'production') throw new Error('No se crean datos demo en producción');
  const password = process.env.DEMO_PASSWORD ?? 'demo-finanzas-2026';
  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.company.findFirst({ where: { name: DEMO_COMPANY, isDemo: true } });
    if (existing) {
      console.log('La empresa demo ya existe; no se modifica.');
      return;
    }
    const companyId = uuidv7();
    const users = [];
    for (const u of DEMO_USERS) {
      const user = await tx.user.upsert({
        where: { email: u.email },
        create: { id: uuidv7(), email: u.email, fullName: u.fullName, passwordHash },
        update: {},
      });
      users.push({ ...u, id: user.id });
    }
    const owner = users[0]!;
    await tx.company.create({
      data: { id: companyId, name: DEMO_COMPANY, isDemo: true, createdBy: owner.id },
    });
    await tx.branch.create({ data: { id: uuidv7(), companyId, name: 'Principal', isDefault: true, createdBy: owner.id } });
    for (const u of users) {
      const role = await tx.role.findFirstOrThrow({ where: { key: u.role, companyId: null } });
      await tx.companyMembership.create({
        data: { id: uuidv7(), companyId, userId: u.id, roleId: role.id, createdBy: owner.id },
      });
    }
  });
  console.log(`Datos demo listos. Usuarios: ${DEMO_USERS.map((u) => u.email).join(', ')} (contraseña: DEMO_PASSWORD o la predeterminada del README).`);
}

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('Falta DATABASE_MIGRATION_URL');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await syncReferenceData(prisma);
    console.log('Permisos y roles de sistema sincronizados.');
    if (process.argv.includes('--demo')) await seedDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
