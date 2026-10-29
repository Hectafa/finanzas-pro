# Reglas de dinero y redondeo

Implementación: [`packages/shared/src/money.ts`](../packages/shared/src/money.ts). Pruebas: `money.test.ts`.

| Regla | Valor |
|---|---|
| Tipo en la API | Texto decimal (`"1234.50"`). Nunca `number` de JavaScript. |
| Tipo en el código | `Dec` (decimal.js, 40 dígitos de precisión). `toDec()` rechaza `number`. |
| Tipo en PostgreSQL | `NUMERIC(19,4)` importes · `NUMERIC(19,6)` cantidades y costos unitarios. |
| Importes de documentos | 2 decimales, redondeo **half-up** (0.005 → 0.01; -2.345 → -2.35). |
| Costos unitarios | 6 decimales, half-up. |
| Entrada del usuario | Hasta 2 decimales, sin signo, sin separadores de miles (`moneySchema`). |
| Máximo | 999,999,999,999,999.9999 (cabe en `NUMERIC(19,4)`). |
| Redondeo por línea | Cada línea de un documento se redondea; el total es la suma de líneas redondeadas. |
| Diferencias de IVA | Si el IVA calculado sobre el total difiere de la suma por línea, la diferencia se ajusta en la última línea (se implementa en la Fase 3). |
| Visualización | La app formatea el texto recibido; no convierte a `number` (`apps/mobile/src/lib/format.ts`). |

Estas reglas son gerenciales. Los criterios fiscales (p. ej. redondeo en CFDI) deben validarse con un contador antes de cualquier integración fiscal.
