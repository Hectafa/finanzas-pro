import { useState } from 'react';
import type { z } from 'zod';
import { ApiError } from './api';

/**
 * Formulario con validación Zod (los mismos esquemas que usa la API). Los errores del
 * servidor por campo se muestran en el campo correspondiente; el resto, como mensaje general.
 */
export function useZodForm<S extends z.ZodType<unknown, Record<string, unknown>>>(schema: S, initial: z.input<S>) {
  const [values, setValues] = useState<z.input<S>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof z.input<S> & string) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((e) => {
      const { [field]: _removed, ...rest } = e;
      return rest;
    });
  };

  const submit = (onValid: (data: z.output<S>) => Promise<void>) => async () => {
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setSubmitting(true);
    try {
      await onValid(parsed.data);
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fieldErrors;
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(e.message);
      } else {
        setFormError('Ocurrió un error inesperado');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return { values, errors, formError, submitting, set, submit, setFormError };
}
