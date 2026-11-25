import { Module } from '@nestjs/common';
import { DemandesModule } from '../demandes/demandes.module';
import { OuvragesModule } from '../ouvrages/ouvrages.module';
import { CertificatPdfService } from './certificat-pdf.service';
import { CertificatsController } from './certificats.controller';
import { CertificatsService } from './certificats.service';

@Module({
  imports: [DemandesModule, OuvragesModule],
  controllers: [CertificatsController],
  providers: [CertificatsService, CertificatPdfService],
  exports: [CertificatsService, CertificatPdfService],
})
export class CertificatsModule {}
