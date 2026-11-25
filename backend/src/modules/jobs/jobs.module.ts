import { Module } from '@nestjs/common';
import { OuvragesModule } from '../ouvrages/ouvrages.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [OuvragesModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
