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
import { AuthUser } from '../../common/types/auth-user.type';
import {
  CreatePrelevementDto,
  ListPrelevementsQueryDto,
  ReceptionPrelevementDto,
  SyncPrelevementsDto,
} from './dto/prelevement.dto';
import { PrelevementsService } from './prelevements.service';

@ApiTags('Prelevements')
@ApiBearerAuth()
@Controller('prelevements')
export class PrelevementsController {
  constructor(private readonly prelevementsService: PrelevementsService) {}

  @Get()
  @Roles(
    Role.AGENT_PRELEVEUR,
    Role.LABORATOIRE,
    Role.AGENT_COMMUNAL,
    Role.MINEE,
    Role.ADMIN,
  )
  @ApiOperation({ summary: 'Prélèvements dans le périmètre' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPrelevementsQueryDto,
  ) {
    return this.prelevementsService.list(user, query);
  }

  @Post()
  @Roles(Role.AGENT_PRELEVEUR)
  @ApiOperation({ summary: 'Enregistre un prélèvement (en ligne)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePrelevementDto,
    @Req() req: Request,
  ) {
    return this.prelevementsService.create(user, dto, req.ip);
  }

  @Post('sync')
  @Roles(Role.AGENT_PRELEVEUR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Synchronisation différée de fiches hors ligne' })
  sync(
    @CurrentUser() user: AuthUser,
    @Body() dto: SyncPrelevementsDto,
    @Req() req: Request,
  ) {
    return this.prelevementsService.syncBatch(user, dto, req.ip);
  }

  @Post(':id/photo')
  @Roles(Role.AGENT_PRELEVEUR)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Photo du prélèvement (WebP <= 200 Ko)' })
  uploadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.prelevementsService.uploadPhoto(user, id, file, req.ip);
  }

  @Post(':id/reception')
  @Roles(Role.LABORATOIRE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accusé de réception horodaté par le laboratoire (ou rejet)',
  })
  reception(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceptionPrelevementDto,
    @Req() req: Request,
  ) {
    return this.prelevementsService.reception(user, id, dto, req.ip);
  }
}
