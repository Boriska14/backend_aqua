import { Module } from '@nestjs/common';
import { NormesController } from './normes.controller';
import { NormesService } from './normes.service';

@Module({
  controllers: [NormesController],
  providers: [NormesService],
  exports: [NormesService],
})
export class NormesModule {}
