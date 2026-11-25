import { Global, Module } from '@nestjs/common';
import { ScopePolicyService } from './scope-policy.service';

@Global()
@Module({
  providers: [ScopePolicyService],
  exports: [ScopePolicyService],
})
export class ScopeModule {}
