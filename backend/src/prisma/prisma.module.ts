import { Global, Module } from '@nestjs/common';
import { SystemParamsService } from '../common/utils/system-params.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, SystemParamsService],
  exports: [PrismaService, SystemParamsService],
})
export class PrismaModule {}
