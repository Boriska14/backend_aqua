import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
  fullName: string;
  phone: string;
  email: string | null;
  locale: string;
  communeId: number | null;
  communeScopeIds: number[];
  laboratoireId: string | null;
  organisationId: string | null;
  habilitationUntil: string | null;
  mfaEnabled: boolean;
  mfaVerifiedAt: number | null;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  mfaVerifiedAt?: number;
  type: 'access' | 'mfa';
}
