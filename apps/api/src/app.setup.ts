import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { APP_ENV, type AppEnv } from './config/env';

export const API_PREFIX = 'v1';

/** Configuración compartida por main.ts y las pruebas de integración. */
export function configureApp(app: INestApplication): INestApplication {
  const env = app.get<AppEnv>(APP_ENV);
  const express = app as NestExpressApplication;

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(helmet());
  express.useBodyParser('json', { limit: '1mb' });
  // Detrás de un proxy administrado (Render/Railway/Fly) para obtener la IP real del cliente.
  express.set('trust proxy', 1);
  app.enableCors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false });
  app.enableShutdownHooks();

  if (env.DOCS_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('Finanzas Pro API')
      .setDescription('API REST de Finanzas Pro. Las rutas de empresa requieren el encabezado X-Company-Id.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  }
  return app;
}
