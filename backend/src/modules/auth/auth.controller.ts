import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { AuthService } from './auth.service';
import {
  Confirm2faDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshTokenDto,
  StaffLoginDto,
  UpdateMeDto,
  Verify2faDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('auth/otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Demande d'un code d'accès par SMS (propriétaire)" })
  requestOtp(@Body() dto: OtpRequestDto, @Req() req: Request) {
    return this.authService.requestOtp(dto, req.ip);
  }

  @Public()
  @Post('auth/otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Vérifie le code et ouvre la session' })
  verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request) {
    return this.authService.verifyOtp(dto, req.ip);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Connexion des profils staff' })
  staffLogin(@Body() dto: StaffLoginDto, @Req() req: Request) {
    return this.authService.staffLogin(dto, req.ip);
  }

  @Public()
  @Post('auth/2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Valide le second facteur (TOTP ou code de secours)',
  })
  verify2fa(@Body() dto: Verify2faDto, @Req() req: Request) {
    return this.authService.verify2fa(dto, req.ip);
  }

  @Public()
  @Post('auth/2fa/enroll')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Démarre l'enrôlement TOTP" })
  async enroll2fa(@Req() req: Request) {
    const userId = await this.authService.resolveEnrollUserFromHeader(
      req.headers.authorization,
    );
    return this.authService.enroll2fa(userId);
  }

  @Public()
  @Post('auth/2fa/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Confirme l'enrôlement et génère 10 codes de secours",
  })
  async confirm2fa(@Body() dto: Confirm2faDto, @Req() req: Request) {
    const userId = await this.authService.resolveEnrollUserFromHeader(
      req.headers.authorization,
    );
    return this.authService.confirm2fa(userId, dto, req.ip);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotation du refresh token' })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, req.ip);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Révoque le refresh token' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
  ) {
    await this.authService.logout(user.id, body?.refreshToken, req.ip);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil courant, rôle, périmètre' })
  getMe(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Met à jour nom, e-mail, langue' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(user, dto);
  }
}
