import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { DeclarePaiementDto, RejectPaiementDto } from './dto/paiement.dto';
import { PaiementsService } from './paiements.service';

@ApiTags('Paiements')
@ApiBearerAuth()
@Controller()
export class PaiementsController {
  constructor(private readonly paiementsService: PaiementsService) {}

  @Get('demandes/:id/paiements')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Historique des paiements et solde' })
  listForDemande(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paiementsService.listForDemande(user, id);
  }

  @Post('demandes/:id/paiements')
  @Roles(Role.PROPRIETAIRE, Role.ENTREPRISE_FORAGE_ONG, Role.AGENT_COMMUNAL)
  @ApiOperation({
    summary: 'Déclare un paiement avec référence de transaction',
  })
  declare(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclarePaiementDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.paiementsService.declare(user, id, dto, idempotencyKey, req.ip);
  }

  @Post('paiements/:id/confirm')
  @Roles(Role.ADMIN, Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirme un paiement et émet le reçu' })
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.paiementsService.confirm(user, id, req.ip);
  }

  @Post('paiements/:id/reject')
  @Roles(Role.ADMIN, Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejette un paiement' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPaiementDto,
    @Req() req: Request,
  ) {
    return this.paiementsService.reject(user, id, dto, req.ip);
  }

  @Get('recus/:id/pdf')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @Audited('RECU_PDF_DOWNLOAD', 'Recu')
  @ApiOperation({ summary: 'Reçu PDF' })
  async getReceiptPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const url = await this.paiementsService.getReceiptPdfUrl(user, id);
    return res.redirect(302, url);
  }
}
