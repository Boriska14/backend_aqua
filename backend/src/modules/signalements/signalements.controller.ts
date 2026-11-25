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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import {
  CreateSignalementDto,
  ListSignalementsQueryDto,
  UpdateSignalementDto,
} from './dto/signalement.dto';
import { SignalementsService } from './signalements.service';

@Controller()
export class SignalementsController {
  constructor(private readonly signalementsService: SignalementsService) {}

  @Public()
  @Post('public/signalements')
  @ApiTags('Public')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('photos', 3))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Dépose un signalement citoyen (sans compte)' })
  createPublic(
    @Body() dto: CreateSignalementDto,
    @UploadedFiles() photos: Express.Multer.File[],
    @Req() req: Request,
  ) {
    return this.signalementsService.createPublic(dto, photos ?? [], req.ip);
  }

  @Public()
  @Get('public/signalements/:trackingNumber')
  @ApiTags('Public')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Suivi d'un signalement par numéro" })
  trackPublic(@Param('trackingNumber') trackingNumber: string) {
    return this.signalementsService.trackPublic(trackingNumber);
  }

  @Get('signalements')
  @ApiTags('Signalements')
  @ApiBearerAuth()
  @Roles(Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Signalements de la commune (ou tous pour MINEE)' })
  listStaff(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSignalementsQueryDto,
  ) {
    return this.signalementsService.listStaff(user, query);
  }

  @Get('signalements/:id')
  @ApiTags('Signalements')
  @ApiBearerAuth()
  @Roles(Role.AGENT_COMMUNAL, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Détail (avec photos)' })
  findOneStaff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.signalementsService.findOneStaff(user, id);
  }

  @Patch('signalements/:id')
  @ApiTags('Signalements')
  @ApiBearerAuth()
  @Roles(Role.AGENT_COMMUNAL, Role.MINEE)
  @ApiOperation({ summary: 'Prend en charge / résout / escalade' })
  updateStaff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSignalementDto,
    @Req() req: Request,
  ) {
    return this.signalementsService.updateStaff(user, id, dto, req.ip);
  }
}
