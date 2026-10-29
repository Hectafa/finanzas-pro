import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, canGrant, isPermission } from './permissions';
import { registerSchema } from './schemas';

const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!;

describe('permisos', () => {
  it('no hay permisos duplicados y todos los roles usan permisos del catálogo', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(isPermission(p)).toBe(true);
  });

  it('el administrador puede otorgar el rol de empleado pero no el de propietario ni contador', () => {
    const admin = role('ADMIN').permissions;
    expect(canGrant(admin, role('EMPLOYEE').permissions)).toBe(true);
    expect(canGrant(admin, role('OWNER').permissions)).toBe(false);
    expect(canGrant(admin, role('ACCOUNTANT').permissions)).toBe(false);
  });

  it('el empleado no puede otorgar roles con más permisos', () => {
    expect(canGrant(role('EMPLOYEE').permissions, role('ADMIN').permissions)).toBe(false);
  });

  it('solo el propietario gestiona usuarios y nómina', () => {
    for (const r of SYSTEM_ROLES) {
      expect(r.permissions.includes('users:manage')).toBe(r.key === 'OWNER');
    }
    expect(role('ADMIN').permissions).not.toContain('payroll:view');
  });
});

describe('registerSchema', () => {
  const base = { email: 'Ana@Ejemplo.MX ', fullName: 'Ana', password: 'una-clave-segura-1' };

  it('normaliza el correo', () => {
    expect(registerSchema.parse(base).email).toBe('ana@ejemplo.mx');
  });

  it('rechaza contraseñas cortas, comunes o que contienen el correo', () => {
    expect(registerSchema.safeParse({ ...base, password: 'corta' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'password123' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'ana-es-genial-2026' }).success).toBe(false);
  });
});
