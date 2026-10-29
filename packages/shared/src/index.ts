import { z } from 'zod';

// Mensajes de validación genéricos en español (API y app).
z.config(z.locales.es());

export * from './permissions';
export * from './money';
export * from './period';
export * from './schemas';
export * from './finance';
export * from './api-types';
