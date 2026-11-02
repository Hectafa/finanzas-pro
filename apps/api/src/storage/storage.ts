import type { AttachmentMimeType } from '@finanzas/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { AppEnv } from '../config/env';

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Puerto de almacenamiento de archivos. La implementación se elige con STORAGE_DRIVER; R2/S3 se
 * agrega antes de producción sin cambiar a quien lo usa. Las claves las arma `attachmentKey`.
 */
export abstract class Storage {
  abstract put(key: string, data: Buffer): Promise<void>;
  /** null si no existe. Solo lo usan los drivers que sirven los archivos desde la API. */
  abstract read(key: string): Promise<Buffer | null>;
  /** URL de corta vida para ver el archivo sin enviar el token de sesión (p. ej. en una <Image>). */
  abstract signedUrl(key: string, now?: Date): SignedUrl;
}

export const EXTENSIONS: Record<AttachmentMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const MIME_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime as AttachmentMimeType]),
) as Record<string, AttachmentMimeType>;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
/** Nombre del archivo dentro de la carpeta de la empresa: <id>.<ext>. */
const FILE_NAME_RE = new RegExp(`^${UUID}\\.(jpg|png|webp|pdf)$`);

export function attachmentKey(companyId: string, attachmentId: string, mime: AttachmentMimeType) {
  return `companies/${companyId}/attachments/${attachmentId}.${EXTENSIONS[mime]}`;
}

/** Valida las partes de una clave recibida en la URL: evita salir de la carpeta (../) o inventar rutas. */
export function keyFromParts(companyId: string, fileName: string): string | null {
  return UUID_RE.test(companyId) && FILE_NAME_RE.test(fileName)
    ? `companies/${companyId}/attachments/${fileName}`
    : null;
}

/**
 * Firma HMAC de las URLs que sirve la propia API. La llave se deriva del secreto de JWT con una
 * etiqueta propia: no hace falta otro secreto y no se usa la misma llave para dos fines.
 */
export class UrlSigner {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = createHmac('sha256', secret).update('finanzas:storage-url-signing:v1').digest();
  }

  private signature(key: string, exp: number): string {
    return createHmac('sha256', this.key).update(`${key}|${exp}`).digest('base64url');
  }

  sign(key: string, now = new Date()): SignedUrl {
    const exp = Math.floor(now.getTime() / 1000) + this.ttlSeconds;
    const path = key.replace(/^companies\/([^/]+)\/attachments\//, '/v1/files/$1/');
    return {
      url: `${path}?exp=${exp}&sig=${this.signature(key, exp)}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  verify(key: string, exp: string, sig: string, now = new Date()): boolean {
    if (!/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < now.getTime()) return false;
    const expected = Buffer.from(this.signature(key, Number(exp)));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

/** Desarrollo: archivos en apps/api/.storage/ (ignorada por git), servidos por FilesController. */
export class LocalDiskStorage extends Storage {
  private readonly root: string;

  constructor(
    dir: string,
    readonly signer: UrlSigner,
  ) {
    super();
    this.root = resolve(process.cwd(), dir);
  }

  private path(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error('Clave de almacenamiento inválida');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    // Escritura atómica: nunca queda un archivo a medias con el nombre definitivo.
    const tmp = `${full}.part`;
    await writeFile(tmp, data);
    await rename(tmp, full);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  signedUrl(key: string, now?: Date): SignedUrl {
    return this.signer.sign(key, now);
  }
}

/** Pruebas automatizadas. */
export class MemoryStorage extends Storage {
  readonly files = new Map<string, Buffer>();

  constructor(readonly signer: UrlSigner) {
    super();
  }

  async put(key: string, data: Buffer): Promise<void> {
    this.files.set(key, Buffer.from(data));
  }

  async read(key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }

  signedUrl(key: string, now?: Date): SignedUrl {
    return this.signer.sign(key, now);
  }
}

export function createStorage(env: AppEnv): LocalDiskStorage | MemoryStorage {
  const signer = new UrlSigner(env.JWT_ACCESS_SECRET, env.SIGNED_URL_TTL_SECONDS);
  return env.STORAGE_DRIVER === 'memory'
    ? new MemoryStorage(signer)
    : new LocalDiskStorage(env.STORAGE_DIR, signer);
}
