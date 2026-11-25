import { Module } from '@nestjs/common';
import { CertificatsModule } from '../certificats/certificats.module';
import { DemandesModule } from '../demandes/demandes.module';
import { ValidationsMineeController } from './validations-minee.controller';
import { ValidationsMineeService } from './validations-minee.service';

@Module({
  imports: [CertificatsModule, DemandesModule],
  controllers: [ValidationsMineeController],
  providers: [ValidationsMineeService],
  exports: [ValidationsMineeService],
})
export class ValidationsMineeModule {}
