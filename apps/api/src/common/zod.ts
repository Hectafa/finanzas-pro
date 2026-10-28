import { PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import { Errors } from './errors';

type SchemaObject = NonNullable<Extract<Parameters<typeof ApiBody>[0], { schema?: unknown }>['schema']>;

/** Valida y normaliza con un esquema Zod. Las claves no declaradas se descartan. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw Errors.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return result.data;
  }
}

export function toOpenApi(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as SchemaObject;
}

/** Documenta el cuerpo en Swagger a partir del mismo esquema Zod que lo valida. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: toOpenApi(schema) });

export const uuidParam = new ZodPipe(z.uuid('Identificador inválido'));
