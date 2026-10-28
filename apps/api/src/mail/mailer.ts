import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEnv } from '../config/env';
import { uuidv7 } from '../db/ids';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Puerto de correo. La implementación se elige con MAIL_DRIVER. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/** Desarrollo: guarda cada correo como JSON en apps/api/.mail/ (carpeta ignorada por git). */
export class FileMailer extends Mailer {
  private readonly dir = join(process.cwd(), '.mail');

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${uuidv7()}.json`), JSON.stringify(message, null, 2), 'utf8');
  }
}

/** Pruebas automatizadas. */
export class MemoryMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

/** Producción. Implementado contra la API pública de Resend; pendiente de verificar con una cuenta real. */
export class ResendMailer extends Mailer {
  private readonly logger = new Logger('ResendMailer');

  constructor(private readonly env: AppEnv) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // No se registra el destinatario ni el contenido (contiene enlaces con token).
      this.logger.error({ status: res.status }, 'Fallo al enviar correo');
      throw new Error(`Resend respondió ${res.status}`);
    }
  }
}

export function createMailer(env: AppEnv): Mailer {
  switch (env.MAIL_DRIVER) {
    case 'memory':
      return new MemoryMailer();
    case 'resend':
      return new ResendMailer(env);
    default:
      return new FileMailer();
  }
}
