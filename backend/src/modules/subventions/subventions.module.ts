import { Module } from '@nestjs/common';
import { DemandesModule } from '../demandes/demandes.module';
import { SubventionsController } from './subventions.controller';
import { SubventionsService } from './subventions.service';

@Module({
  imports: [DemandesModule],
  controllers: [SubventionsController],
  providers: [SubventionsService],
  exports: [SubventionsService],
})
export class SubventionsModule {}
