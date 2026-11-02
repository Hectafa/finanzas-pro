import { Global, Module } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';
import { FilesController } from './files.controller';
import { createStorage, Storage } from './storage';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    { provide: Storage, inject: [APP_ENV], useFactory: (env: AppEnv) => createStorage(env) },
  ],
  exports: [Storage],
})
export class StorageModule {}
