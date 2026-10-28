import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CompanyAccessGuard } from './company-access.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtAuthGuard, CompanyAccessGuard],
  exports: [TokenService, JwtAuthGuard, CompanyAccessGuard],
})
export class AuthModule {}
