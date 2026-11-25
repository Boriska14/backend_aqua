import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { AnnuaireService } from './annuaire.service';
import {
  CreateLaboratoireDto,
  CreateOrganisationDto,
  CreateRapportInterventionDto,
  ListLaboratoiresQueryDto,
  ListOrganisationsQueryDto,
  UpdateLaboratoireDto,
} from './dto/annuaire.dto';

@ApiTags('Annuaire')
@ApiBearerAuth()
@Controller()
export class AnnuaireController {
  constructor(private readonly annuaireService: AnnuaireService) {}

  @Get('laboratoires')
  @ApiOperation({ summary: 'Laboratoires référencés' })
  listLaboratoires(@Query() query: ListLaboratoiresQueryDto) {
    return this.annuaireService.listLaboratoires(query);
  }

  @Post('laboratoires')
  @Roles(Role.MINEE, Role.ADMIN)
  @StrongAuth()
  @ApiOperation({ summary: 'Crée un laboratoire agréé' })
  createLaboratoire(
    @Body() dto: CreateLaboratoireDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.annuaireService.createLaboratoire(dto, user, req.ip);
  }

  @Patch('laboratoires/:id')
  @Roles(Role.MINEE)
  @StrongAuth()
  @ApiOperation({
    summary: 'Met à jour agrément / portée / statut de référencement',
  })
  updateLaboratoire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLaboratoireDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.annuaireService.updateLaboratoire(id, dto, user, req.ip);
  }

  @Get('organisations')
  @ApiOperation({
    summary: 'Entreprises de traitement / forage / ONG référencées',
  })
  listOrganisations(@Query() query: ListOrganisationsQueryDto) {
    return this.annuaireService.listOrganisations(query);
  }

  @Post('organisations')
  @Roles(Role.MINEE, Role.ADMIN)
  @StrongAuth()
  @ApiOperation({ summary: 'Crée une organisation' })
  createOrganisation(
    @Body() dto: CreateOrganisationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.annuaireService.createOrganisation(dto, user, req.ip);
  }

  @Post('rapports-intervention')
  @Roles(Role.ENTREPRISE_TRAITEMENT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      "Dépose un rapport d'intervention (n'altère aucune donnée certifiante)",
  })
  createRapport(
    @Body() dto: CreateRapportInterventionDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.annuaireService.createRapportIntervention(
      dto,
      file,
      user,
      req.ip,
    );
  }
}
