import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Post,
  Put,
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
import { CreateNormeDto, SeuilItemDto } from './dto/norme.dto';
import { NormesService } from './normes.service';

@ApiTags('Referentiels')
@ApiBearerAuth()
@Controller('normes')
export class NormesController {
  constructor(private readonly normesService: NormesService) {}

  @Get()
  @Roles(Role.LABORATOIRE, Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Versions du référentiel' })
  list(@Query() query: PageQueryDto) {
    return this.normesService.list(query);
  }

  @Post()
  @Roles(Role.MINEE)
  @StrongAuth()
  @ApiOperation({ summary: 'Crée une version BROUILLON' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateNormeDto,
    @Req() req: Request,
  ) {
    return this.normesService.create(actor, dto, req.ip);
  }

  @Put(':id/seuils')
  @Roles(Role.MINEE)
  @StrongAuth()
  @ApiOperation({ summary: "Remplace les seuils d'un BROUILLON" })
  replaceSeuils(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ParseArrayPipe({ items: SeuilItemDto })) items: SeuilItemDto[],
    @Req() req: Request,
  ) {
    return this.normesService.replaceSeuils(actor, id, items, req.ip);
  }

  @Post(':id/publish')
  @Roles(Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publie la version et archive la précédente' })
  publish(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.normesService.publish(actor, id, req.ip);
  }
}
