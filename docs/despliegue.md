# Despliegue (borrador)

> Estado: **no verificado**. Nada de esto se ha desplegado todavía. Se completará y probará en la Fase 6.

## Base de datos (PostgreSQL administrado, p. ej. Neon)

1. Crear dos roles por entorno:
   - `finanzas_owner` (dueño del esquema): solo migraciones y seed.
   - `finanzas_app` (API): **sin** `BYPASSRLS`, sin ser dueño de tablas.
   ```sql
   CREATE ROLE finanzas_app LOGIN PASSWORD '<secreto>' NOSUPERUSER NOBYPASSRLS;
   GRANT CONNECT ON DATABASE <base> TO finanzas_app;
   ```
   La migración `20261028173200_security` requiere que `finanzas_app` exista y le otorga los privilegios.
2. Aplicar migraciones con el rol dueño:
   `DATABASE_MIGRATION_URL=... pnpm --filter @finanzas/api db:migrate`
3. Sincronizar permisos y roles: `pnpm --filter @finanzas/api db:seed` (sin `--demo` en producción; el seed lo impide).

## API

Variables obligatorias (ver `apps/api/.env.example`): `DATABASE_URL` (rol `finanzas_app`), `JWT_ACCESS_SECRET` (≥ 32 caracteres aleatorios, distinto por entorno), `MAIL_DRIVER=resend`, `RESEND_API_KEY`, `MAIL_FROM`, `NODE_ENV=production`, `DOCS_ENABLED=false` (recomendado).

Comandos: `pnpm install --frozen-lockfile && pnpm --filter @finanzas/api build && pnpm --filter @finanzas/api start`.
Salud: `GET /health`.

## App móvil

Builds con EAS (`npx eas-cli@latest build`), con `EXPO_PUBLIC_API_URL` apuntando a la API HTTPS del entorno. Requiere cuentas de Expo, Google Play Console y Apple Developer.
