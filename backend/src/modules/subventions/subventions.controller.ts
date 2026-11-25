import {
  Body,
  Controller,
  Get,
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
import {
  CommuneSubventionDecisionDto,
  CreateEnveloppeDto,
  CreateSubventionDto,
  MineeSubventionDecisionDto,
} from './dto/subvention.dto';
import { SubventionsService } from './subventions.service';

@ApiTags('Subventions')
@ApiBearerAuth()
@Controller()
export class SubventionsController {
  constructor(private readonly subventionsService: SubventionsService) {}

  @Get('subventions')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE)
  @ApiOperation({ summary: 'Dossiers de subvention (périmètre)' })
  list(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.subventionsService.list(user, query);
  }

  @Post('subventions')
  @Roles(Role.PROPRIETAIRE)
  @ApiOperation({ summary: 'Demande de subvention rattachée à une demande' })
  create(
    @Body() dto: CreateSubventionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.subventionsService.create(dto, user, req.ip);
  }

  @Post('subventions/:id/commune-decision')
  @Roles(Role.AGENT_COMMUNAL)
  @ApiOperation({ summary: "Avis d'éligibilité de la commune" })
  communeDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommuneSubventionDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.subventionsService.communeDecision(id, dto, user, req.ip);
  }

  @Post('subventions/:id/minee-decision')
  @Roles(Role.MINEE)
  @StrongAuth()
  @ApiOperation({ summary: 'Arbitrage MINEE et imputation sur une enveloppe' })
  mineeDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MineeSubventionDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.subventionsService.mineeDecision(id, dto, user, req.ip);
  }

  @Get('enveloppes')
  @Roles(Role.MINEE, Role.AGENT_COMMUNAL)
  @ApiOperation({ summary: 'Enveloppes par financeur' })
  listEnveloppes(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.subventionsService.listEnveloppes(user, query);
  }

  @Post('enveloppes')
  @Roles(Role.MINEE)
  @StrongAuth()
  @ApiOperation({ summary: 'Crée une enveloppe de subvention' })
  createEnveloppe(
    @Body() dto: CreateEnveloppeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.subventionsService.createEnveloppe(dto, user, req.ip);
  }
}
