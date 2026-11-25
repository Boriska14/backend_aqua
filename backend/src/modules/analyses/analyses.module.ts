import { Module } from '@nestjs/common';
import { DemandesModule } from '../demandes/demandes.module';
import { NormesModule } from '../normes/normes.module';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';

@Module({
  imports: [NormesModule, DemandesModule],
  controllers: [AnalysesController],
  providers: [AnalysesService],
  exports: [AnalysesService],
})
export class AnalysesModule {}
