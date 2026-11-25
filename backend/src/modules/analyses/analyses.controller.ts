import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { AnalysesService } from './analyses.service';
import {
  CreateAmendementDto,
  DecideAmendementDto,
  ListAnalysesQueryDto,
  OpenAnalyseDto,
  PutAnalyseValeursDto,
} from './dto/analyse.dto';

@ApiTags('Analyses')
@ApiBearerAuth()
@Controller()
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Get('analyses')
  @Roles(Role.LABORATOIRE, Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Analyses du laboratoire ou dans le périmètre' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListAnalysesQueryDto) {
    return this.analysesService.list(user, query);
  }

  @Post('analyses')
  @Roles(Role.LABORATOIRE)
  @ApiOperation({ summary: 'Ouvre une analyse pour un prélèvement reçu' })
  open(
    @CurrentUser() user: AuthUser,
    @Body() dto: OpenAnalyseDto,
    @Req() req: Request,
  ) {
    return this.analysesService.open(user, dto, req.ip);
  }

  @Get('analyses/:id')
  @Roles(
    Role.LABORATOIRE,
    Role.AGENT_COMMUNAL,
    Role.PROPRIETAIRE,
    Role.MINEE,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Détail avec valeurs, seuils et verdict' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analysesService.findOne(user, id);
  }

  @Put('analyses/:id/valeurs')
  @Roles(Role.LABORATOIRE)
  @ApiOperation({ summary: 'Saisit/remplace les valeurs par paramètre' })
  putValues(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PutAnalyseValeursDto,
    @Req() req: Request,
  ) {
    return this.analysesService.putValues(user, id, dto, req.ip);
  }

  @Post('analyses/:id/proces-verbal')
  @Roles(Role.LABORATOIRE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Téléverse le PV signé (PDF)' })
  uploadPv(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.analysesService.uploadProcesVerbal(user, id, file, req.ip);
  }

  @Post('analyses/:id/submit')
  @Roles(Role.LABORATOIRE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Soumet et VERROUILLE l'analyse" })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.analysesService.submit(user, id, req.ip);
  }

  @Post('analyses/:id/amendements')
  @Roles(Role.LABORATOIRE)
  @StrongAuth()
  @ApiOperation({ summary: 'Demande un amendement motivé' })
  requestAmendement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAmendementDto,
    @Req() req: Request,
  ) {
    return this.analysesService.requestAmendement(user, id, dto, req.ip);
  }

  @Post('amendements/:id/decision')
  @Roles(Role.MINEE, Role.ADMIN)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approuve ou refuse un amendement' })
  decideAmendement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAmendementDto,
    @Req() req: Request,
  ) {
    return this.analysesService.decideAmendement(user, id, dto, req.ip);
  }
}
