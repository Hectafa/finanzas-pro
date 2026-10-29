# Finanzas Pro

Aplicación (teléfono Android/iOS y computadora vía navegador) para gestionar las finanzas de negocios (inicialmente alimentos y bebidas): saldos, ingresos y gastos, ventas, compras, inventario con recetas, cuentas por cobrar y pagar, presupuestos, reportes y asistente de IA.

> **Estado:** Fase 1 (fundación) implementada: autenticación, empresas, usuarios, roles y permisos (incluidos roles personalizados editables), aislamiento entre empresas, auditoría, dashboard inicial y versión web para computadora. Las cifras financieras llegan en la Fase 2. Detalle en [docs/fase-1-fundacion.md](docs/fase-1-fundacion.md).

## Estructura

```
apps/api        API REST (NestJS 12, Prisma 7, PostgreSQL 17)
apps/mobile     App para teléfono y web (Expo SDK 58, Expo Router, React Native Paper, react-native-web)
packages/shared Permisos, esquemas de validación, dinero y periodos (compartido API/app)
packages/config Configuración base de TypeScript y reglas de ESLint de dinero
infra/          Docker Compose para la base de datos de desarrollo
docs/           Diseño, decisiones y guías
```

## Requisitos

- Node.js 22.12 o superior
- pnpm 10 (`npm i -g pnpm@10`)
- Docker Desktop (base de datos local)
- Para probar en un teléfono: la app **Expo Go** (Android o iOS), en la misma red Wi-Fi que tu computadora

## Puesta en marcha

```bash
pnpm install                                 # también compila packages/shared y genera el cliente Prisma
pnpm db:up                                   # PostgreSQL en localhost:5433 (Docker Desktop debe estar abierto)
cp apps/api/.env.example apps/api/.env       # luego cambia JWT_ACCESS_SECRET (ver comentario en el archivo)
pnpm db:migrate                              # aplica migraciones
pnpm --filter @finanzas/api db:seed:demo     # permisos, roles y datos de demostración
pnpm api                                     # API en http://localhost:3000 (Swagger: /docs)
```

En otra terminal, la app:

```bash
cp apps/mobile/.env.example apps/mobile/.env  # ajusta EXPO_PUBLIC_API_URL (ver abajo)
pnpm mobile                                   # escanea el QR con Expo Go
```

`EXPO_PUBLIC_API_URL` según dónde corre la app:

| Dónde                             | Valor                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Emulador de Android               | `http://10.0.2.2:3000`                                                                         |
| Simulador de iOS                  | `http://localhost:3000`                                                                        |
| Teléfono físico                   | `http://<IP de tu PC en la red local>:3000` (permite el puerto 3000 en el Firewall de Windows) |
| Navegador en la misma computadora | `http://localhost:3000`                                                                        |

### En la computadora (navegador)

```bash
pnpm web          # abre http://localhost:8081
```

La API debe permitir ese origen: `CORS_ORIGINS=http://localhost:8081` en `apps/api/.env` (ya viene en `.env.example`). Con `APP_WEB_URL=http://localhost:8081`, los correos de recuperación e invitación incluyen también el enlace para abrirlos en el navegador.

`EXPO_PUBLIC_API_URL` es una sola por ejecución: si pruebas teléfono y navegador a la vez, usa la IP de tu PC (`http://192.168.x.x:3000`) y agrega `http://192.168.x.x:8081` a `CORS_ORIGINS` si abres la web desde otro equipo.

### Usuarios de demostración

Creados por `db:seed:demo` en la empresa **"Cafetería Demo (DATOS DE PRUEBA)"** (`is_demo = true`):

| Correo                              | Rol         | Contraseña                               |
| ----------------------------------- | ----------- | ---------------------------------------- |
| `propietario@demo.finanzaspro.test` | Propietario | `demo-finanzas-2026` (o `DEMO_PASSWORD`) |
| `empleado@demo.finanzaspro.test`    | Empleado    | igual                                    |

Solo para desarrollo; el seed se niega a crear datos demo con `NODE_ENV=production`.

### Correos en desarrollo

Con `MAIL_DRIVER=file`, los correos (recuperación de contraseña, invitaciones) se guardan como JSON en `apps/api/.mail/`. El enlace (`finanzaspro://...`) abre la app en el teléfono o emulador:

```bash
npx uri-scheme open "finanzaspro://reset-password?token=..." --android
```

## Pruebas

```bash
pnpm lint        # ESLint, incluidas las reglas de dinero (nada de number/parseFloat para importes)
pnpm typecheck   # tipos de todos los paquetes
pnpm test        # unitarias + integración (la API usa la base finanzas_test de Docker)
```

Las pruebas de integración de la API corren contra PostgreSQL real con el mismo rol restringido que usa la API en producción, por lo que verifican también la seguridad por fila.

## Documentación

- [Fase 0 — Análisis y diseño](docs/fase-0-analisis-y-diseno.md)
- [Fase 1 — Fundación](docs/fase-1-fundacion.md)
- [Reglas de dinero y redondeo](docs/reglas-de-redondeo.md)
- [Despliegue (borrador)](docs/despliegue.md)
- API: Swagger en `http://localhost:3000/docs` con la API en ejecución
