/**
 * Catálogo de permisos `módulo:acción`. Es la única definición: el backend lo sincroniza a la
 * base de datos (seed) y la app lo usa solo para mostrar u ocultar opciones. La autorización
 * real siempre se resuelve en el servidor con los permisos guardados en la base de datos.
 */
export const PERMISSIONS = [
  'dashboard:view',
  'transactions:view',
  'transactions:view_own',
  'transactions:create',
  'transactions:update',
  'transactions:approve',
  'transactions:void',
  'transactions:export',
  'sales:view',
  'sales:create',
  'sales:update',
  'sales:void',
  'sales:export',
  'sales:override_price',
  'purchases:view',
  'purchases:create',
  'purchases:update',
  'purchases:void',
  'purchases:export',
  'inventory:view',
  'inventory:create',
  'inventory:update',
  'inventory:export',
  'receivables:view',
  'receivables:create',
  'receivables:approve',
  'receivables:export',
  'budgets:view',
  'budgets:create',
  'budgets:update',
  'budgets:export',
  'payroll:view',
  'payroll:manage',
  'payroll:export',
  'reports:view',
  'reports:export',
  'ai:use',
  'users:view',
  'users:invite',
  'users:manage',
  'settings:view',
  'settings:manage',
  'audit:view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLE_KEYS = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'OWNER',
    name: 'Propietario',
    description: 'Acceso completo, configuración, usuarios y permisos.',
    permissions: PERMISSIONS,
  },
  {
    key: 'ADMIN',
    name: 'Administrador',
    description: 'Gestión operativa y financiera; puede invitar empleados.',
    permissions: [
      'dashboard:view',
      'transactions:view',
      'transactions:view_own',
      'transactions:create',
      'transactions:update',
      'transactions:approve',
      'transactions:void',
      'sales:view',
      'sales:create',
      'sales:update',
      'sales:void',
      'sales:export',
      'sales:override_price',
      'purchases:view',
      'purchases:create',
      'purchases:update',
      'purchases:void',
      'purchases:export',
      'inventory:view',
      'inventory:create',
      'inventory:update',
      'inventory:export',
      'receivables:view',
      'receivables:create',
      'receivables:approve',
      'budgets:view',
      'budgets:create',
      'budgets:update',
      'reports:view',
      'reports:export',
      'ai:use',
      'users:view',
      'users:invite',
      'settings:view',
      'audit:view',
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Contador',
    description: 'Movimientos, categorías, reportes y exportaciones autorizadas.',
    permissions: [
      'dashboard:view',
      'transactions:view',
      'transactions:view_own',
      'transactions:create',
      'transactions:approve',
      'transactions:void',
      'transactions:export',
      'sales:view',
      'sales:export',
      'purchases:view',
      'purchases:export',
      'inventory:view',
      'inventory:export',
      'receivables:view',
      'receivables:export',
      'budgets:view',
      'budgets:export',
      'payroll:view',
      'payroll:export',
      'reports:view',
      'reports:export',
      'ai:use',
      'settings:view',
      'audit:view',
    ],
  },
  {
    key: 'EMPLOYEE',
    name: 'Empleado',
    description: 'Captura de movimientos y ventas; consulta solo de lo propio.',
    permissions: ['transactions:view_own', 'transactions:create', 'sales:view', 'sales:create'],
  },
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Un usuario solo puede asignar roles cuyos permisos ya posee (evita escalamiento). */
export function canGrant(granter: Iterable<string>, requested: Iterable<string>): boolean {
  const own = new Set(granter);
  for (const p of requested) if (!own.has(p)) return false;
  return true;
}
