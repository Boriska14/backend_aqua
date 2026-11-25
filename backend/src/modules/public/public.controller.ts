import {
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { I18nService } from '../../common/i18n/i18n.service';
import { NoStoreInterceptor } from '../../common/interceptors/no-store.interceptor';
import { PublicMapQueryDto, PublicOuvragesQueryDto } from './dto/public.dto';
import { PublicService } from './public.service';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly i18n: I18nService,
  ) {}

  @Public()
  @Get('verify/:token')
  @UseInterceptors(NoStoreInterceptor)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Vérification d’un QR (écran public, 5 cas, toujours 200)',
  })
  verify(
    @Param('token') token: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = this.i18n.resolveLocale(acceptLanguage);
    return this.publicService.verifyQr(token, locale);
  }

  @Public()
  @Get('ouvrages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Recherche publique d'ouvrages" })
  searchOuvrages(@Query() query: PublicOuvragesQueryDto) {
    return this.publicService.searchOuvrages(query);
  }

  @Public()
  @Get('ouvrages/:aquasafeNumber')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Fiche publique' })
  getOuvrage(@Param('aquasafeNumber') aquasafeNumber: string) {
    return this.publicService.getOuvrageByNumber(aquasafeNumber);
  }

  @Public()
  @Get('map/ouvrages')
  @Header('Content-Type', 'application/geo+json')
  @Header('Cache-Control', 'public, max-age=60')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ouvrages pour la carte (GeoJSON FeatureCollection)',
  })
  getMap(@Query() query: PublicMapQueryDto) {
    return this.publicService.getMapGeoJson(query);
  }

  @Public()
  @Get('stats')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Compteurs publics' })
  getStats() {
    return this.publicService.getStats();
  }
}
