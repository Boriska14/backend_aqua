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
import { AuthUser } from '../../common/types/auth-user.type';
import { DemandesService } from './demandes.service';
import {
  CommuneValidationDto,
  CreateContreAnalyseDto,
  CreateDemandeDto,
  ListDemandesQueryDto,
  SubmitDemandeDto,
} from './dto/demande.dto';

@ApiTags('Demandes')
@ApiBearerAuth()
@Controller('demandes')
export class DemandesController {
  constructor(private readonly demandesService: DemandesService) {}

  @Get()
  @Roles(
    Role.PROPRIETAIRE,
    Role.ENTREPRISE_FORAGE_ONG,
    Role.AGENT_COMMUNAL,
    Role.LABORATOIRE,
    Role.MINEE,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Liste des demandes dans le périmètre' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListDemandesQueryDto) {
    return this.demandesService.list(user, query);
  }

  @Post()
  @Roles(Role.PROPRIETAIRE, Role.ENTREPRISE_FORAGE_ONG, Role.AGENT_COMMUNAL)
  @ApiOperation({ summary: 'Crée une demande (brouillon)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDemandeDto,
    @Req() req: Request,
  ) {
    return this.demandesService.create(user, dto, req.ip);
  }

  @Get(':id')
  @Roles(
    Role.PROPRIETAIRE,
    Role.ENTREPRISE_FORAGE_ONG,
    Role.AGENT_COMMUNAL,
    Role.AGENT_PRELEVEUR,
    Role.LABORATOIRE,
    Role.MINEE,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Détail + chronologie des étapes' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.demandesService.findOne(user, id);
  }

  @Post(':id/submit')
  @Roles(Role.PROPRIETAIRE, Role.ENTREPRISE_FORAGE_ONG, Role.AGENT_COMMUNAL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumet la demande (fige le tarif)' })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDemandeDto,
    @Req() req: Request,
  ) {
    return this.demandesService.submit(user, id, dto, req.ip);
  }

  @Post(':id/commune-validation')
  @Roles(Role.AGENT_COMMUNAL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Valide ou rejette l'adhésion (commune)" })
  communeValidation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommuneValidationDto,
    @Req() req: Request,
  ) {
    return this.demandesService.communeValidation(user, id, dto, req.ip);
  }

  @Post(':id/cancel')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annule (avant prélèvement)' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.demandesService.cancel(user, id, req.ip);
  }

  @Post(':id/contre-analyses')
  @Roles(Role.PROPRIETAIRE, Role.MINEE)
  @ApiOperation({ summary: 'Ouvre une contre-analyse' })
  openContreAnalyse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContreAnalyseDto,
    @Req() req: Request,
  ) {
    return this.demandesService.openContreAnalyse(user, id, dto, req.ip);
  }
}
