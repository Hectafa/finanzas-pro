import type { CompanySummaryDto } from '@finanzas/shared';
import type { Company, Role } from '../generated/prisma/client';

export const roleRef = (role: Pick<Role, 'id' | 'key' | 'name'>) => ({ id: role.id, key: role.key, name: role.name });

export function toCompanySummary(company: Company, role: Role): CompanySummaryDto {
  return {
    id: company.id,
    name: company.name,
    currency: company.currency,
    timeZone: company.timeZone,
    isDemo: company.isDemo,
    role: roleRef(role),
  };
}
