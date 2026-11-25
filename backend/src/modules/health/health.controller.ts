import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HealthCheckResult, HealthService } from './health.service';

@ApiTags('Systeme')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness / readiness (base, stockage)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 503, description: 'Dégradé' })
  async getHealth(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
}
