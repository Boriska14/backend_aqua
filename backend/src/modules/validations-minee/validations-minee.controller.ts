import {
  Body,
  Controller,
  Delete,
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
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../../common/types/auth-user.type';
import {
  BatchValidateMineeDto,
  CreateDelegationDto,
} from './dto/validation-minee.dto';
import { ValidationsMineeService } from './validations-minee.service';

@ApiTags('Validation MINEE')
@ApiBearerAuth()
@Controller('minee')
export class ValidationsMineeController {
  constructor(private readonly service: ValidationsMineeService) {}

  @Get('validations')
  @Roles(Role.MINEE, Role.ADMIN, Role.AGENT_COMMUNAL)
  @ApiOperation({
    summary: 'File de validation (demandes EN_VALIDATION_MINEE)',
  })
  listQueue(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.service.listQueue(user, query);
  }

  @Post('validations/batch')
  @Roles(Role.MINEE, Role.ADMIN, Role.AGENT_COMMUNAL)
  @StrongAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valide/rejette par lot — émet les certificats' })
  batch(
    @CurrentUser() user: AuthUser,
    @Body() dto: BatchValidateMineeDto,
    @Req() req: Request,
  ) {
    return this.service.batchValidate(user, dto, req.ip);
  }

  @Get('delegations')
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: 'Délégations de validation' })
  listDelegations() {
    return this.service.listDelegations();
  }

  @Post('delegations')
  @Roles(Role.MINEE)
  @StrongAuth()
  @ApiOperation({ summary: 'Crée une délégation journalisée' })
  createDelegation(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDelegationDto,
    @Req() req: Request,
  ) {
    return this.service.createDelegation(user, dto, req.ip);
  }

  @Delete('delegations/:id')
  @Roles(Role.MINEE)
  @StrongAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Révoque une délégation' })
  async revokeDelegation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.service.revokeDelegation(user, id, req.ip);
  }
}
