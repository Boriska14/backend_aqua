import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { CertificatsService } from './certificats.service';
import {
  ConfirmPlaqueDto,
  ListCertificatsQueryDto,
  ReasonDto,
} from './dto/certificat.dto';

@ApiTags('Certificats')
@ApiBearerAuth()
@Controller('certificats')
export class CertificatsController {
  constructor(private readonly certificatsService: CertificatsService) {}

  @Get()
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Registre des certificats (périmètre)' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListCertificatsQueryDto) {
    return this.certificatsService.list(user, query);
  }

  @Get(':id')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Détail + transitions' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.certificatsService.findOne(user, id);
  }

  @Get(':id/pdf')
  @Roles(
    Role.PROPRIETAIRE,
    Role.AGENT_COMMUNAL,
    Role.AGENT_PRELEVEUR,
    Role.MINEE,
  )
  @Audited('CERTIFICAT_PDF_DOWNLOAD', 'Certificat')
  @ApiQuery({ name: 'lang', required: false, enum: ['fr', 'en'] })
  @ApiOperation({
    summary:
      'Télécharge le PDF filigrané (propriétaire et agents habilités SEULS)',
  })
  async downloadPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang: 'fr' | 'en' = 'fr',
    @Res() res: Response,
  ) {
    const safeLang = lang === 'en' ? 'en' : 'fr';
    const { buffer, filename } = await this.certificatsService.getPdfBuffer(
      user,
      id,
      safeLang,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  }

  @Post(':id/confirm-plaque')
  @Roles(Role.AGENT_COMMUNAL, Role.AGENT_PRELEVEUR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirme la pose de la plaque -> EMIS -> ACTIF' })
  confirmPlaque(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPlaqueDto,
    @Req() req: Request,
  ) {
    return this.certificatsService.confirmPlaque(user, id, dto, req.ip);
  }

  @Post(':id/suspend')
  @Roles(Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend (révocation immédiate du QR)' })
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.certificatsService.suspend(user, id, dto, req.ip);
  }

  @Post(':id/reactivate')
  @Roles(Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réactive un certificat suspendu' })
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.certificatsService.reactivate(user, id, dto, req.ip);
  }

  @Post(':id/withdraw')
  @Roles(Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retire définitivement (QR révoqué)' })
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.certificatsService.withdraw(user, id, dto, req.ip);
  }
}
