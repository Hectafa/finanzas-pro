# Finanzas Pro

Aplicación móvil para gestionar las finanzas de negocios (inicialmente alimentos y bebidas): saldos, ingresos y gastos, ventas, compras, inventario con recetas, cuentas por cobrar y pagar, presupuestos, reportes y asistente de IA.

> **Estado:** Fase 0 (análisis y diseño) aprobada. La Fase 1 (fundación) aún no ha comenzado; todavía no hay código ejecutable.

## Documentación

- [Fase 0 — Análisis y diseño](docs/fase-0-analisis-y-diseno.md): alcance, arquitectura, modelo de datos, reglas contables, sincronización offline, seguridad, plan de pruebas y decisiones aprobadas.

## Arquitectura (resumen)

| Capa | Tecnología |
|---|---|
| Móvil | Expo · React Native · TypeScript · Expo Router · React Native Paper · TanStack Query · Zustand · SQLite (SQLCipher) |
| Backend | NestJS · TypeScript · Prisma · PostgreSQL · Zod · pg-boss · OpenAPI |
| Monorepo | pnpm workspaces · Turborepo |

## Requisitos de desarrollo

- Node.js 22 LTS
- pnpm (`corepack enable`)
- Docker Desktop (PostgreSQL de desarrollo y pruebas de integración)

Las instrucciones de instalación y ejecución se añadirán al completar la Fase 1.
