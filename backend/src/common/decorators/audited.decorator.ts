import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'auditedMetadata';

export interface AuditedOptions {
  action: string;
  entityType: string;
  entityIdParam?: string;
}

export const Audited = (
  action: string,
  entityType: string,
  entityIdParam = 'id',
) =>
  SetMetadata(AUDITED_KEY, {
    action,
    entityType,
    entityIdParam,
  } satisfies AuditedOptions);
