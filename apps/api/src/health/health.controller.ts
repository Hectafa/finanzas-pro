import { Controller, Get, HttpStatus, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/request-context';
import { DbService } from '../db/db.service';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', time: new Date().toISOString() };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', database: 'unreachable', time: new Date().toISOString() };
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
