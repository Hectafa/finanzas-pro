import { Global, Module } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';
import { Mailer, createMailer } from './mailer';

@Global()
@Module({
  providers: [{ provide: Mailer, inject: [APP_ENV], useFactory: (env: AppEnv) => createMailer(env) }],
  exports: [Mailer],
})
export class MailModule {}
