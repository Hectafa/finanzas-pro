import { PERMISSIONS, SYSTEM_ROLES } from '@finanzas/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { uuidv7 } from './ids';

/**
 * Sincroniza el catálogo de permisos y los roles de sistema con @finanzas/shared.
 * Idempotente. Se ejecuta con el rol dueño del esquema (seed y pruebas), nunca desde la API.
 */
export async function syncReferenceData(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const key of PERMISSIONS) {
      const [module, action] = key.split(':') as [string, string];
      await tx.permission.upsert({ where: { key }, create: { key, module, action }, update: { module, action } });
    }

    for (const def of SYSTEM_ROLES) {
      const existing = await tx.role.findFirst({ where: { key: def.key, companyId: null } });
      const role = existing
        ? await tx.role.update({ where: { id: existing.id }, data: { name: def.name, description: def.description } })
        : await tx.role.create({
            data: { id: uuidv7(), key: def.key, name: def.name, description: def.description, isSystem: true },
          });
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionKey: { notIn: [...def.permissions] } },
      });
      await tx.rolePermission.createMany({
        data: def.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
    }

    // Permisos retirados del catálogo: se quitan de cualquier rol antes de borrarlos.
    const obsolete = { notIn: [...PERMISSIONS] as string[] };
    await tx.rolePermission.deleteMany({ where: { permissionKey: obsolete } });
    await tx.permission.deleteMany({ where: { key: obsolete } });
  });
}
