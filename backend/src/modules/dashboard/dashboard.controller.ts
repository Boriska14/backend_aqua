import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

@ApiTags('Pilotage')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('minee')
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({
    summary: 'Couverture, conformité, délais, expirations (EF-29)',
  })
  getMinee(@Query() query: DashboardQueryDto) {
    return this.dashboardService.getMineeDashboard(query);
  }

  @Get('commune')
  @Roles(Role.AGENT_COMMUNAL)
  @ApiOperation({
    summary: "Tableau de bord de la commune de l'appelant (EF-30)",
  })
  getCommune(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getCommuneDashboard(user);
  }
}
