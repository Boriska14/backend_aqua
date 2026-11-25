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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StrongAuth } from '../../common/decorators/strong-auth.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Comptes (filtre rôle/statut)' })
  list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  @Post()
  @Roles(Role.ADMIN)
  @StrongAuth()
  @ApiOperation({ summary: 'Crée un compte staff' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ) {
    return this.usersService.create(actor, dto, req.ip);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @StrongAuth()
  @ApiOperation({ summary: 'Statut, rôle, périmètre ; reset 2FA' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.usersService.update(actor, id, dto, req.ip);
  }
}
