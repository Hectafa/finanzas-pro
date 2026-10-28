import { z } from 'zod';
import { isValidTimeZone } from './period';

const COMMON_PASSWORDS = new Set([
  '1234567890',
  '12345678910',
  'contraseña1',
  'contrasena123',
  'password123',
  'password1234',
  'qwertyuiop',
  'abc1234567',
  'mexico12345',
  'finanzas123',
  'finanzaspro',
  'iloveyou123',
  '1q2w3e4r5t',
  'aaaaaaaaaa',
]);

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Correo inválido').max(254));

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña no puede exceder 128 caracteres')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'Esa contraseña es demasiado común');

const nameSchema = z.string().trim().min(1, 'Requerido').max(120);
const deviceNameSchema = z.string().trim().max(80).optional();

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: nameSchema,
    deviceName: deviceNameSchema,
  })
  .refine((v) => !v.password.toLowerCase().includes(v.email.split('@')[0]!), {
    message: 'La contraseña no debe contener tu correo',
    path: ['password'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  deviceName: deviceNameSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const createCompanySchema = z.object({
  name: nameSchema,
  legalName: z.string().trim().max(200).optional(),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC con formato inválido')
    .optional(),
  currency: z.literal('MXN').default('MXN'),
  timeZone: z
    .string()
    .default('America/Mexico_City')
    .refine(isValidTimeZone, 'Zona horaria inválida'),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .object({
    name: nameSchema,
    legalName: z.string().trim().max(200).nullable(),
    taxId: createCompanySchema.shape.taxId.unwrap().nullable(),
    timeZone: z.string().refine(isValidTimeZone, 'Zona horaria inválida'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios');
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const createInvitationSchema = z.object({
  email: emailSchema,
  roleId: z.uuid(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(200) });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const changeMemberRoleSchema = z.object({ roleId: z.uuid() });
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const createRoleSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).min(1).max(100),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
