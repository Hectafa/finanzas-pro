import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  type AuthResponse,
  type AuthTokens,
  type ForgotPasswordInput,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
  type ResetPasswordInput,
  type SessionDto,
  type UserDto,
} from '@finanzas/shared';
import { AuthRateLimit, CurrentAuth, Public, type AppRequest, type AuthContext } from '../common/request-context';
import { ApiZodBody, ZodPipe, uuidParam } from '../common/zod';
import { AuthService } from './auth.service';

const rid = (req: AppRequest) => (req.id ? String(req.id) : undefined);

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AuthRateLimit()
  @Post('register')
  @ApiZodBody(registerSchema)
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: AppRequest): Promise<AuthResponse> {
    return this.auth.register(body, rid(req));
  }

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: AppRequest): Promise<AuthResponse> {
    return this.auth.login(body, rid(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiZodBody(refreshSchema)
  refresh(@Body(new ZodPipe(refreshSchema)) body: RefreshInput, @Req() req: AppRequest): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken, rid(req));
  }

  @Public()
  @AuthRateLimit()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiZodBody(forgotPasswordSchema)
  async forgotPassword(@Body(new ZodPipe(forgotPasswordSchema)) body: ForgotPasswordInput, @Req() req: AppRequest) {
    await this.auth.forgotPassword(body.email, rid(req));
    return { message: 'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña' };
  }

  @Public()
  @AuthRateLimit()
  @Post('reset-password')
  @HttpCode(204)
  @ApiZodBody(resetPasswordSchema)
  async resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput, @Req() req: AppRequest) {
    await this.auth.resetPassword(body, rid(req));
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    return this.auth.me(auth.userId);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentAuth() auth: AuthContext) {
    await this.auth.logoutAll(auth);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentAuth() auth: AuthContext): Promise<SessionDto[]> {
    return this.auth.listSessions(auth);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id', uuidParam) id: string) {
    await this.auth.revokeSession(auth, id);
  }
}
