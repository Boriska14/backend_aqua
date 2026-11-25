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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import { CreateGrilleDto, EstimationQueryDto } from './dto/tarif.dto';
import { TarifsService } from './tarifs.service';

@ApiTags('Referentiels')
@ApiBearerAuth()
@Controller()
export class TarifsController {
  constructor(private readonly tarifsService: TarifsService) {}

  @Get('grilles-tarifaires')
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Grilles tarifaires' })
  list(@Query() query: PageQueryDto) {
    return this.tarifsService.listGrilles(query);
  }

  @Post('grilles-tarifaires')
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Crée une grille BROUILLON avec ses lignes' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateGrilleDto,
    @Req() req: Request,
  ) {
    return this.tarifsService.createGrille(actor, dto, req.ip);
  }

  @Post('grilles-tarifaires/:id/activate')
  @Roles(Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valide (MINEE) et active la grille tarifaire' })
  activate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.tarifsService.activateGrille(actor, id, req.ip);
  }

  @Get('tarifs/estimation')
  @ApiTags('Paiements')
  @ApiOperation({ summary: "Estime le tarif d'une demande" })
  estimate(@Query() query: EstimationQueryDto) {
    return this.tarifsService.estimateForOuvrage(query.ouvrageId);
  }
}
