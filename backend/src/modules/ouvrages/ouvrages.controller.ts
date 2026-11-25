import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import {
  CreateOuvrageDto,
  ListOuvragesQueryDto,
  SieImportQueryDto,
  UpdateOuvrageDto,
  UploadOuvrageDocumentDto,
} from './dto/ouvrage.dto';
import { OuvragesService } from './ouvrages.service';
import { SieImportService } from './sie-import.service';

@ApiTags('Ouvrages')
@ApiBearerAuth()
@Controller('ouvrages')
export class OuvragesController {
  constructor(
    private readonly ouvragesService: OuvragesService,
    private readonly sieImportService: SieImportService,
  ) {}

  @Get()
  @Roles(
    Role.PROPRIETAIRE,
    Role.ENTREPRISE_FORAGE_ONG,
    Role.AGENT_COMMUNAL,
    Role.AGENT_PRELEVEUR,
    Role.MINEE,
    Role.ADMIN,
  )
  @ApiOperation({
    summary: "Liste des ouvrages dans le périmètre de l'appelant",
  })
  list(@CurrentUser() user: AuthUser, @Query() query: ListOuvragesQueryDto) {
    return this.ouvragesService.list(user, query);
  }

  @Post()
  @Roles(
    Role.PROPRIETAIRE,
    Role.ENTREPRISE_FORAGE_ONG,
    Role.AGENT_COMMUNAL,
    Role.MINEE,
  )
  @ApiOperation({ summary: 'Déclare un ouvrage' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOuvrageDto,
    @Req() req: Request,
  ) {
    return this.ouvragesService.create(user, dto, req.ip);
  }

  @Post('import-sie')
  @Roles(Role.MINEE, Role.ADMIN)
  @StrongAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import initial du fichier SIE (CSV/XLSX) — idempotent sur sieId',
  })
  importSie(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: SieImportQueryDto,
    @Req() req: Request,
  ) {
    return this.sieImportService.importFile(
      user,
      file,
      Boolean(body.dryRun),
      body.columnMapper,
      req.ip,
    );
  }

  @Get('import-sie/:jobId')
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: "État et rapport d'erreurs de l'import" })
  getImportJob(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.sieImportService.getJob(jobId);
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
  @ApiOperation({ summary: 'Fiche privée complète (selon périmètre)' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ouvragesService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.MINEE)
  @ApiOperation({ summary: 'Met à jour les données administratives' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOuvrageDto,
    @Req() req: Request,
  ) {
    return this.ouvragesService.update(user, id, dto, req.ip);
  }

  @Get(':id/dossier')
  @Roles(
    Role.PROPRIETAIRE,
    Role.AGENT_COMMUNAL,
    Role.LABORATOIRE,
    Role.MINEE,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Dossier numérique' })
  getDossier(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ouvragesService.getDossier(user, id);
  }

  @Post(':id/documents')
  @Roles(Role.PROPRIETAIRE, Role.AGENT_COMMUNAL, Role.ENTREPRISE_FORAGE_ONG)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Ajoute un document au dossier' })
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UploadOuvrageDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.ouvragesService.addDocument(user, id, body.kind, file, req.ip);
  }
}
