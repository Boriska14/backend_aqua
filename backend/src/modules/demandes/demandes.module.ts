import { Module } from '@nestjs/common';
import { OuvragesModule } from '../ouvrages/ouvrages.module';
import { TarifsModule } from '../tarifs/tarifs.module';
import { DemandeStateMachineService } from './demande-state-machine.service';
import { DemandesController } from './demandes.controller';
import { DemandesService } from './demandes.service';

@Module({
  imports: [OuvragesModule, TarifsModule],
  controllers: [DemandesController],
  providers: [DemandesService, DemandeStateMachineService],
  exports: [DemandesService, DemandeStateMachineService],
})
export class DemandesModule {}
