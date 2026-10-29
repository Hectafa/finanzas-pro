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

/** Etiquetas para mostrar el catálogo agrupado por módulo (no afectan la autorización). */
export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dashboard: 'Inicio',
  transactions: 'Movimientos',
  sales: 'Ventas',
  purchases: 'Compras',
  inventory: 'Inventario',
  receivables: 'Cuentas por cobrar y pagar',
  budgets: 'Presupuestos',
  payroll: 'Nómina',
  reports: 'Reportes',
  ai: 'Asistente de IA',
  users: 'Usuarios',
  settings: 'Configuración',
  audit: 'Auditoría',
};

export const PERMISSION_ACTION_LABELS: Record<string, string> = {
  view: 'Ver',
  view_own: 'Ver lo propio',
  create: 'Crear',
  update: 'Editar',
  approve: 'Aprobar',
  void: 'Anular',
  export: 'Exportar',
  override_price: 'Cambiar precio',
  manage: 'Administrar',
  invite: 'Invitar',
  use: 'Usar',
};

/** Catálogo agrupado por módulo, en el orden de PERMISSIONS. */
export function permissionGroups(): {
  module: string;
  label: string;
  permissions: { key: Permission; label: string }[];
}[] {
  const groups = new Map<string, { key: Permission; label: string }[]>();
  for (const key of PERMISSIONS) {
    const [module, action] = key.split(':') as [string, string];
    if (!groups.has(module)) groups.set(module, []);
    groups.get(module)!.push({ key, label: PERMISSION_ACTION_LABELS[action] ?? action });
  }
  return [...groups].map(([module, permissions]) => ({
    module,
    label: PERMISSION_MODULE_LABELS[module] ?? module,
    permissions,
  }));
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Un usuario solo puede asignar roles cuyos permisos ya posee (evita escalamiento). */
export function canGrant(granter: Iterable<string>, requested: Iterable<string>): boolean {
  const own = new Set(granter);
  for (const p of requested) if (!own.has(p)) return false;
  return true;
}
