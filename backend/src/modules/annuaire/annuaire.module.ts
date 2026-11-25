import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AnnuaireController } from './annuaire.controller';
import { AnnuaireService } from './annuaire.service';

@Module({
  imports: [DocumentsModule],
  controllers: [AnnuaireController],
  providers: [AnnuaireService],
  exports: [AnnuaireService],
})
export class AnnuaireModule {}
