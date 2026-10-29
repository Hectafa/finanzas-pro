import { sha256Hex } from '../db/ids';

export interface HashableAuditEntry {
  id: string;
  companyId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: unknown;
  createdAt: Date;
}

/** JSON con claves ordenadas: el resultado no depende del orden en que jsonb devuelve las claves. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeAuditHash(prevHash: string | null, entry: HashableAuditEntry): string {
  return sha256Hex(
    canonicalJson({
      prevHash,
      id: entry.id,
      companyId: entry.companyId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      data: entry.data ?? null,
      createdAt: entry.createdAt.toISOString(),
    }),
  );
}
