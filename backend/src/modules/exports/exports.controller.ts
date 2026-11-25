import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { ExportsService } from './exports.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post('system')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.ADMIN)
  @StrongAuth()
  @ApiOperation({
    summary:
      'Export complet données + métadonnées de fichiers (réversibilité EN-12)',
  })
  exportSystem(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.exportsService.createSystemExport(user, req.ip);
  }
}
