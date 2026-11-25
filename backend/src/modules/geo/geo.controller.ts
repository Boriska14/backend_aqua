import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { GeoService } from './geo.service';

@ApiTags('Public')
@Controller('public')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Public()
  @Get('regions')
  @ApiOperation({ summary: 'Régions' })
  listRegions() {
    return this.geoService.listRegions();
  }

  @Public()
  @Get('communes')
  @ApiOperation({ summary: 'Communes (filtre région)' })
  @ApiQuery({ name: 'regionId', required: false, type: Number })
  listCommunes(
    @Query('regionId', new ParseIntPipe({ optional: true })) regionId?: number,
  ) {
    return this.geoService.listCommunes(regionId);
  }
}
