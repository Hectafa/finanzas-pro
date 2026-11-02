import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Errors } from '../common/errors';
import { Public } from '../common/request-context';
import {
  keyFromParts,
  LocalDiskStorage,
  MemoryStorage,
  MIME_BY_EXTENSION,
  Storage,
} from './storage';

const INVALID_LINK = 'El enlace no es válido o ya venció';

/**
 * Sirve comprobantes del almacenamiento local mediante URL firmada. No usa el token de sesión: la
 * firma y su vencimiento son la autorización. Con R2/S3 las URLs apuntan al proveedor y esto no se usa.
 */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: Storage) {}

  @Public()
  @Get(':companyId/:fileName')
  async get(
    @Param('companyId') companyId: string,
    @Param('fileName') fileName: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const storage = this.storage;
    if (!(storage instanceof LocalDiskStorage || storage instanceof MemoryStorage)) {
      throw Errors.notFound();
    }
    const key = keyFromParts(companyId, fileName);
    // Misma respuesta si la clave es inválida, la firma no coincide o venció: no revela qué existe.
    if (!key || !exp || !sig || !storage.signer.verify(key, exp, sig)) {
      throw Errors.notFound(INVALID_LINK);
    }
    const data = await storage.read(key);
    if (!data) throw Errors.notFound(INVALID_LINK);
    res.set({
      'Content-Type': MIME_BY_EXTENSION[fileName.split('.').pop()!],
      'Content-Length': String(data.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=60',
      // Un PDF o una imagen manipulados no pueden ejecutar nada en el origen de la API.
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      // La app web (otro origen) puede mostrarlos en <img>.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(data);
  }
}
