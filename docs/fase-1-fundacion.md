# Fase 1 — Fundación del sistema

> Estado: **implementada y probada localmente** · 2026-10-28 · rama `fase-1-fundacion`

## 1. Qué incluye

| Área | Implementado |
|---|---|
| Monorepo | pnpm 10 + Turborepo; paquetes `api`, `mobile`, `shared`, `config`. |
| Base de datos | PostgreSQL 17 en Docker; migraciones Prisma versionadas; seed idempotente; datos demo marcados. |
| Autenticación | Registro, inicio de sesión, recuperación de contraseña por correo, refresh token rotativo, sesiones por dispositivo, cierre de sesión individual y global, bloqueo tras 5 intentos. |
| Empresas | Crear empresa (con sucursal principal), listar "mis empresas", empresa activa, editar datos. |
| Usuarios y permisos | Roles de sistema (Propietario, Administrador, Contador, Empleado) y personalizados; permisos `módulo:acción`; invitaciones por correo; revocar y reactivar acceso. |
| Aislamiento | Guarda por empresa en cada ruta + **Row-Level Security** en PostgreSQL. |
| Auditoría | Bitácora append-only con cadena de hashes por empresa y endpoint de verificación. |
| Dashboard | Endpoint y pantalla con periodo (día/semana/mes/trimestre/año/personalizado) en la zona horaria de la empresa. Las cifras financieras muestran "Aún sin datos" hasta la Fase 2. |
| App móvil | Login, registro, recuperación, aceptar invitación (enlaces `finanzaspro://`), selección/creación de empresa, 5 pestañas, usuarios y accesos, sesiones activas. |
| Calidad | 104 pruebas automatizadas; CI en GitHub Actions (tipos, pruebas con PostgreSQL real, empaquetado Android/iOS). |
| API docs | Swagger/OpenAPI en `/docs`, generado desde los mismos esquemas Zod que validan. |

## 2. Decisiones técnicas tomadas en esta fase

| Decisión | Motivo |
|---|---|
| NestJS 12, Prisma 7.10, TypeScript 6.0, Expo SDK 58 | Versiones estables vigentes y compatibles entre sí. Prisma 8 sigue en *release candidate*; TypeScript 7 aún no es compatible con NestJS/Expo. |
| Validación con Zod 4 sin `nestjs-zod` | `nestjs-zod` no soporta NestJS 12; Zod 4 genera JSON Schema/OpenAPI de forma nativa. |
| Dos roles de base de datos | `finanzas_owner` migra; `finanzas_app` (API) no es dueño de tablas, por lo que RLS le aplica siempre. |
| Contexto RLS por transacción (`set_config(..., true)`) | Seguro con pool de conexiones: el contexto no se filtra entre solicitudes. |
| `db.system()` explícito para omitir RLS | Solo en autenticación y aceptación de invitaciones por token. Fácil de auditar con una búsqueda. |
| Permisos leídos de la BD en cada solicitud | Revocar o cambiar un rol surte efecto inmediato; el JWT solo identifica usuario y sesión. |
| Regla "solo otorgas lo que tienes" | Evita escalamiento: un Administrador puede invitar Empleados, no Propietarios ni Contadores. |
| Respuesta 404 para empresas ajenas | No revela si una empresa existe. |
| Token de acceso en memoria; refresh token en SecureStore | El token de larga vida queda en Keychain/Keystore; el de corta vida nunca se persiste. |
| Renovación de sesión en "vuelo único" | El servidor rota el refresh token; dos renovaciones simultáneas se detectarían como robo. |
| UUID v7 generados por la aplicación | Ordenables por tiempo; preparan la generación offline en el dispositivo (Fase 2). |
| Expo Go compatible | En esta fase no hay módulos nativos fuera de Expo Go; SQLCipher (Fase 2) requerirá *development build*. |

## 3. Supuestos documentados

- Moneda única MXN por empresa; zona horaria por defecto `America/Mexico_City`.
- La verificación de correo al registrarse queda pendiente (campo `email_verified_at` listo); las invitaciones solo se aceptan con la cuenta del correo invitado.
- El adaptador de correo de producción (Resend) está implementado pero **no verificado** con una cuenta real.
- Límite por IP: 120 solicitudes/min general, 10/min en rutas de autenticación (configurable).

## 4. Pruebas

| Paquete | Pruebas | Qué cubren |
|---|---|---|
| shared | 23 | Dinero decimal y redondeo, periodos con zonas horarias y horario de verano, catálogo de permisos, validación de contraseñas. |
| api | 69 | Registro, login, bloqueo, rotación y reutilización de refresh token (incluida concurrencia), logout, sesiones, recuperación de contraseña; aislamiento en las 14 rutas de empresa; RLS directa en PostgreSQL (lectura, inserción, actualización cruzada); bitácora inmodificable; roles, invitaciones, escalamiento, último propietario con concurrencia; cadena de auditoría y detección de manipulación; dashboard y periodos. |
| mobile | 12 | Cliente HTTP: renovación única ante 401 concurrentes, cierre de sesión si se rechaza la renovación, conservación de la sesión sin red, errores por campo; formato de importes sin punto flotante. |

Además se verificó manualmente: arranque real de la API, login del usuario demo, dashboard, errores y Swagger (24 rutas) con `curl`; empaquetado de la app para Android e iOS con `expo export`; `expo-doctor` 19/20 (ver §6).

## 5. Cómo ejecutar

Ver [README](../README.md#puesta-en-marcha).

## 6. Pendiente, limitaciones y avisos

| Tema | Estado |
|---|---|
| Prueba de la app en un teléfono o emulador real | **Pendiente de que la ejecutes**: no tengo acceso a un dispositivo. El código compila y se empaqueta para ambas plataformas. |
| Pruebas E2E móviles (Maestro) | Pendiente (Fase 2, junto con el flujo offline). |
| Lint (ESLint) | Pendiente: no configurado todavía; CI valida tipos, pruebas y empaquetado. |
| Verificación de correo al registrarse | Pendiente. |
| Edición de roles personalizados (renombrar, cambiar permisos, archivar) | Pendiente; hoy se pueden crear y asignar. |
| `expo-doctor` reporta `react-native` 0.88.1 vs 0.88.0 esperado | Se conserva 0.88.1: es la versión que fijan la plantilla oficial de SDK 58 y `bundledNativeModules.json` del paquete `expo` instalado; la discrepancia viene del servicio remoto que consulta `expo-doctor`. |
| Correo real (Resend), despliegue, builds firmados | Fase 6 / cuando se elijan cuentas. |

## 7. Siguiente fase

Fase 2 — Finanzas esenciales: libro contable interno, cuentas (caja, terminal, banco), ingresos, gastos, transferencias, categorías, adjuntos, saldos reconstruibles, auditoría de movimientos y captura offline con SQLite cifrada y sincronización idempotente.
