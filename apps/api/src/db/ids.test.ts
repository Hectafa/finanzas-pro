import { describe, expect, it } from 'vitest';
import { canonicalJson, computeAuditHash } from '../audit/audit-hash';
import { newOpaqueToken, sha256Hex, uuidv7 } from './ids';

describe('uuidv7', () => {
  it('tiene formato y versión correctos', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('es ordenable por tiempo y único', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});

describe('tokens opacos', () => {
  it('el hash corresponde al token y no lo contiene', () => {
    const { token, hash } = newOpaqueToken();
    expect(hash).toBe(sha256Hex(token));
    expect(hash).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });
});

describe('hash de auditoría', () => {
  const entry = {
    id: '01a18398-d74e-77e0-929b-b770a0da1b10',
    companyId: null,
    actorUserId: null,
    action: 'x',
    entityType: 'User',
    entityId: null,
    data: { b: 1, a: 'z' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('no depende del orden de las claves', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: null }] })).toBe(canonicalJson({ a: [2, { c: null, d: 1 }], b: 1 }));
    expect(computeAuditHash(null, entry)).toBe(computeAuditHash(null, { ...entry, data: { a: 'z', b: 1 } }));
  });

  it('cambia si cambia cualquier campo o el hash anterior', () => {
    const base = computeAuditHash(null, entry);
    expect(computeAuditHash('a'.repeat(64), entry)).not.toBe(base);
    expect(computeAuditHash(null, { ...entry, action: 'y' })).not.toBe(base);
    expect(computeAuditHash(null, { ...entry, createdAt: new Date('2026-01-01T00:00:00.001Z') })).not.toBe(base);
  });
});
