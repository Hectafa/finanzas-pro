# To read — dónde nos quedamos

> Actualizado: 2026-10-31. Léelo antes de continuar.
> Siguiente paso acordado: **Fase 2, bloque C (comprobantes)**. El bloque B está en el PR `fase-2-pantallas` (pendiente de fusionar).

## 1. Estado en una línea

La **Fase 1 está cerrada** (PR #1 y #2 fusionados). Del **bloque A de la Fase 2** (núcleo contable de la API) está fusionado el PR #3. El **bloque B (pantallas)** está terminado, revisado por el usuario en web y en PR (`fase-2-pantallas`). **Faltan los bloques C y D.**

| Rama / PR | Contenido | Estado |
|---|---|---|
| PR #1 `fase-1-fundacion` | Auth, empresas, roles, RLS, auditoría, dashboard inicial, app Expo | Fusionado |
| PR #2 `fase-1-cierre` | ESLint y reglas de dinero, edición de roles personalizados, versión web | Fusionado |
| PR #3 `fase-2-finanzas` | Libro contable, cuentas, categorías, movimientos, dashboard con cifras reales | Fusionado |
| PR #4 `fase-2-pantallas` | Bloque B: cuentas, categorías, Registrar, Movimientos, detalle, Inicio | Abierto |
| `main` | Contiene PR #1 a #3 | CI en verde |

Pruebas automatizadas: **185** (shared 27, mobile 23, API 135). Lint y tipos limpios.

## 2. Cómo levantar todo mañana

1. Abre **Docker Desktop** y espera a que arranque.
2. En la raíz del proyecto:
   ```bash
   git checkout main && git pull
   pnpm install          # compila shared y genera Prisma (postinstall)
   pnpm db:up            # PostgreSQL en localhost:5433
   pnpm db:migrate       # aplica migraciones pendientes
   pnpm db:seed          # permisos, roles y configuración financiera de empresas existentes
   pnpm api              # API → http://localhost:3000  (Swagger: /docs)
   ```
3. En otra terminal: `pnpm web` → http://localhost:8081 (computadora), o `pnpm mobile` para el teléfono con Expo Go.

- **Usuarios demo:** `propietario@demo.finanzaspro.test` y `empleado@demo.finanzaspro.test`, ambos con contraseña `demo-finanzas-2026`.
- **Datos demo:** la "Cafetería Demo" ya tiene cuentas (Caja, BBVA, Terminal Clip), ventas, gastos, una transferencia y un gasto del empleado por revisar. El dashboard muestra cifras reales.
- **`.env`:** `apps/api/.env` y `apps/mobile/.env` ya existen localmente; no se suben al repo. La web usa `EXPO_PUBLIC_API_URL=http://localhost:3000`. Para el teléfono, usa la IP de la PC.

## 3. Lo que ya está hecho

### Fase 1 (cerrada)
- **Autenticación:** registro, login, recuperación de contraseña, refresh token rotativo, sesiones por dispositivo y bloqueo por intentos.
- **Empresas, usuarios e invitaciones:** roles de sistema y roles personalizados, que se pueden crear, editar con control de versión y archivar.
- **Aislamiento entre empresas:** guarda en cada ruta y RLS en PostgreSQL. **Auditoría:** encadenada por hashes.
- **ESLint:** incluye reglas de dinero que prohíben `number` y `parseFloat` para importes.
- **Versión web:** la misma app en el navegador (react-native-web), con la sesión en `localStorage`.

### Fase 2, bloque A (API)
- **Libro de partida doble:** `LedgerService` es el único escritor. La base de datos exige que cada asiento cuadre y es append-only para la API.
- **Cuentas de dinero:** efectivo, banco, billetera y terminal. El saldo inicial se registra como asiento y los saldos se derivan del libro.
- **Categorías:** 12 predeterminadas, un nivel de subcategoría y cada una con su propia cuenta contable.
- **Movimientos:**
  - Tipos: ingreso, gasto (con IVA de 16, 8 o 0 %), transferencia, y aportación o retiro de socios.
  - Idempotencia por `id` generado en el dispositivo.
  - Revisión: un empleado captura en estado `PENDING_REVIEW`.
  - Anulación por asiento de reversa.
  - Listado paginado por cursor.
- **Dashboard:** disponible, por depositar, ingresos y gastos sin IVA, flujo neto y movimientos por revisar aparte.
- **Endpoints:** `/v1/accounts`, `/v1/categories`, `/v1/transactions` (`/approve`, `/void`) y `/v1/ledger/verify`. Contratos en `packages/shared/src/finance.ts`.

### Fase 2, bloque B (pantallas, PR `fase-2-pantallas`)
- **Más › Cuentas de dinero** (`(app)/cuentas.tsx`): lista con saldos, crear con saldo inicial y fecha, renombrar, archivar, ver archivadas.
- **Más › Categorías** (`(app)/categorias.tsx`): gastos e ingresos, subcategorías, renombrar, archivar.
- **Registrar**: ingreso, gasto, transferencia, aportación y retiro. `id` generado en el dispositivo (`expo-crypto`); si falla la red se conserva el `id` para reintentar sin duplicar. IVA 16/8/0 con vista previa, fecha con "Hoy/Ayer" (DD/MM/AAAA, "hoy" en la zona de la empresa), teclado decimal.
- **Movimientos**: búsqueda, filtros por estado, tipo y cuenta, paginación por cursor. Detalle en `(app)/movimiento/[id].tsx`: aprobar, anular o rechazar con motivo, editar campos descriptivos.
- **Inicio**: tarjeta "Por depositar" y aviso "N por revisar" que abre Movimientos filtrado.
- `todayIn` y `addDays` se movieron a `packages/shared` (los usan la API y la app).
- Componentes nuevos en `components/ui.tsx`: `SelectField` y `DateField`.
- Revisado por el usuario en la web (2026-11-01). Falta probarlo en un teléfono real.
- La prueba dejó en la Cafetería Demo una cuenta "MP renombrada …" con saldo 250.50, y un gasto y una transferencia anulados.

## 4. Faltantes

### Fase 2 — por hacer, en este orden
- [x] **Bloque B: pantallas.** Hecho y revisado en web; falta probarlo en teléfono.
- [ ] **Bloque C: comprobantes.**
  - Puerto `Storage` con **disco local en desarrollo** (decidido), URLs firmadas de corta vida y validación de tipo y tamaño.
  - Detección de duplicados por `sha256` con confirmación explícita.
  - Subida desde cámara o galería.
- [ ] **Bloque D: offline en el teléfono.**
  - SQLite cifrada (SQLCipher) con clave en SecureStore, y una cola de salida (*outbox*) con reintentos.
  - Sincronización usando la idempotencia que ya existe.
  - Estados visibles: "Guardado en el teléfono", "Sincronizado", "Requiere revisión".
  - Requiere **development build con EAS** (decidido): cuenta gratuita en expo.dev. Para iPhone se necesita cuenta de Apple Developer.
  - **La web queda solo en línea** (decidido): sin red, avisa y no captura.
- [ ] **Pruebas E2E en el teléfono con Maestro**, junto con el offline.
- [ ] Actualizar `docs/fase-0-analisis-y-diseno.md` §13 y crear `docs/fase-2-finanzas.md` al cerrar la fase.

### Pendientes de la Fase 1 (no bloquean)
- [ ] **Probar en un teléfono real.** Es criterio de aceptación de la Fase 1 y solo tú puedes hacerlo.
- [ ] **Verificación de correo al registrarse.** El campo `email_verified_at` existe; falta el flujo.
- [ ] Restaurar un rol archivado. Hoy hay que crear uno nuevo.
- [ ] Menú lateral para escritorio en la web. Conviene evaluarlo en la Fase 3, cuando haya más módulos.

### Diferido a fases posteriores
| Tema | Fase |
|---|---|
| Cierre de periodos (`PeriodLock`): impedir contabilizar en fechas cerradas | 3 o 4 |
| Conciliación nocturna automática: recalcular saldos y alertar diferencias (`/ledger/verify` ya existe) | 6 |
| Configurar por empresa si los movimientos del empleado requieren revisión (hoy depende del permiso `transactions:approve`) | 3 |
| Liquidaciones de terminal con comisión, ventas, compras, CxC y CxP, inventario y recetas | 3 |
| Reportes, presupuestos, nómina y exportaciones | 4 |
| IA: OCR de comprobantes y asistente | 5 |
| Web en producción: refresh token en cookie `HttpOnly` con protección CSRF y CSP | 6 |
| Correo real (Resend), despliegue, builds firmados | 6 |

## 5. Decisiones tomadas en esta sesión
- **Commits:** primero un commit de formato con Prettier y luego el funcional, para que el diff se pueda revisar. Los PR se abren contra `main`.
- **Web:** la misma app que el teléfono. **Sin captura offline en web.**
- **Comprobantes:** disco local en desarrollo, detrás de un puerto intercambiable por R2 o S3.
- **Build móvil:** EAS en la nube.
- **Reglas contables:**
  - La anulación revierte en la **fecha original** del movimiento.
  - No se aceptan **fechas futuras**.
  - El flujo neto excluye saldos iniciales.
  - Sin cuentas de dinero, el dashboard muestra "no disponible", no $0.00.
- **ESLint 9 (no 10):** por compatibilidad con `eslint-config-expo`.

## 6. Avisos y riesgos
- **El repo sigue en OneDrive.** La Fase 0 (D2) recomienda moverlo a `C:\dev\finanzas-pro`, porque OneDrive puede bloquear archivos o romper `node_modules`. Conviene hacerlo antes del bloque D.
- **Acentos en pruebas manuales:** no envíes textos con tildes o ñ con `curl -d` desde Git Bash o PowerShell. La consola de Windows los convierte mal y el servidor guarda "�" (U+FFFD). Así se dañaron 3 descripciones demo, ya corregidas el 2026-11-01. Usa Swagger (`/docs`), la app o un script de Node. La app y la API sí guardan bien UTF-8.
- **Reloj y zona horaria:** las fechas de negocio usan la zona de la empresa (`America/Mexico_City`). Git Bash en Windows no reconoce esa zona: para obtener "hoy" en scripts, usa Node con luxon.
- **Migración del libro:** se corrigió la función de cuadre dentro de `20261029130000_ledger` antes de publicarla. Si alguna base local marca la migración como modificada, la solución es `npx prisma migrate reset` en desarrollo. Eso borra los datos locales y luego hay que correr `pnpm --filter @finanzas/api db:seed:demo`.
- `expo-doctor` marca la versión de `react-native` (0.88.1 contra 0.88.0); está documentado y es intencional.
- **Recarga en web:** al recargar la página, la consola muestra algunos 401. Es normal: el token de acceso vive solo en memoria y se renueva solo.
