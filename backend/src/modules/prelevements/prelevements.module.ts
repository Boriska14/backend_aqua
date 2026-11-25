import { Module } from '@nestjs/common';
import { DemandesModule } from '../demandes/demandes.module';
import { PrelevementsController } from './prelevements.controller';
import { PrelevementsService } from './prelevements.service';

@Module({
  imports: [DemandesModule],
  controllers: [PrelevementsController],
  providers: [PrelevementsService],
  exports: [PrelevementsService],
})
export class PrelevementsModule {}
