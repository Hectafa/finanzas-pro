import type { AttachmentMimeType } from '@finanzas/shared';

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Tipo real del archivo según sus primeros bytes ("firma"). No se confía en el nombre ni en el
 * Content-Type que manda el cliente: un ejecutable renombrado a .jpg se rechaza.
 */
export function detectFileType(buf: Buffer): AttachmentMimeType | 'image/heic' | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(buf, ascii('%PDF-'))) return 'application/pdf';
  // HEIC (fotos de iPhone): se reconoce para dar un mensaje claro; la app lo convierte a JPG.
  if (startsWith(buf, ascii('ftyp'), 4)) {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}
