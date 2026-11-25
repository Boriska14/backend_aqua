import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { DocumentsService } from './documents.service';

@ApiTags('Ouvrages')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get(':id/download')
  @ApiOperation({
    summary:
      'Télécharge un document (URL signée courte durée ; contrôle de périmètre)',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { url } = await this.documentsService.getSignedDownloadForUser(
      id,
      user,
      req.ip,
    );
    return res.redirect(302, url);
  }
}
