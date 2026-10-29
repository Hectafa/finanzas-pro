import type { AppEnv } from '../config/env';

/**
 * Texto con los enlaces de un correo: el de la app (finanzaspro://...) y, si hay versión web
 * configurada (APP_WEB_URL), también el del navegador para abrirlo desde una computadora.
 */
export function linksText(
  env: Pick<AppEnv, 'APP_LINK_BASE' | 'APP_WEB_URL'>,
  pathAndQuery: string,
): string {
  const app = `${env.APP_LINK_BASE}${pathAndQuery}`;
  if (!env.APP_WEB_URL) return `${app}\n`;
  return `Desde el teléfono (app):\n${app}\n\nDesde una computadora (navegador):\n${env.APP_WEB_URL}/${pathAndQuery}\n`;
}
