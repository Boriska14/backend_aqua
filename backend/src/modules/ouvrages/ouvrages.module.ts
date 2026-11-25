import { Module } from '@nestjs/common';
import { OuvrageStatusService } from './ouvrage-status.service';
import { OuvragesController } from './ouvrages.controller';
import { OuvragesService } from './ouvrages.service';
import { SieImportService } from './sie-import.service';

@Module({
  controllers: [OuvragesController],
  providers: [OuvragesService, OuvrageStatusService, SieImportService],
  exports: [OuvragesService, OuvrageStatusService],
})
export class OuvragesModule {}
