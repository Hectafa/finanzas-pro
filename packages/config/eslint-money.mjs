/**
 * Reglas de dinero (docs/reglas-de-redondeo.md): los importes nunca se representan con `number`.
 * Se usan Decimal (`@finanzas/shared` → Dec/toDec) en cálculos y texto decimal en la API.
 */
const MONEY_NAME =
  '/(amount|total|subtotal|balance|price|cost|fee|importe|monto|saldo|precio|costo|comision)e?s?$/i';
const MESSAGE =
  'Importe tipado como number: usa string (texto decimal) o Dec de @finanzas/shared. Ver docs/reglas-de-redondeo.md';

export const moneyRules = {
  name: 'finanzas/money',
  rules: {
    'no-restricted-globals': [
      'error',
      {
        name: 'parseFloat',
        message: 'parseFloat pierde precisión con importes: usa toDec() de @finanzas/shared.',
      },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'Number',
        property: 'parseFloat',
        message: 'Number.parseFloat pierde precisión con importes: usa toDec().',
      },
    ],
    'no-restricted-syntax': [
      'error',
      // Propiedades de interfaces, tipos y clases: { total: number }
      {
        selector: `:matches(TSPropertySignature, PropertyDefinition)[key.name=${MONEY_NAME}] > TSTypeAnnotation > TSNumberKeyword`,
        message: MESSAGE,
      },
      // Variables y parámetros: (price: number) / let saldo: number
      {
        selector: `Identifier[name=${MONEY_NAME}] > TSTypeAnnotation > TSNumberKeyword`,
        message: MESSAGE,
      },
    ],
  },
};
