import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthUser } from '../types/auth-user.type';
import { RolesGuard } from './roles.guard';
import { ScopePolicyService } from './scope-policy.service';
import { StrongAuthGuard } from './strong-auth.guard';

function makeUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    role: Role.PROPRIETAIRE,
    fullName: 'Test User',
    phone: '+237670000001',
    email: null,
    locale: 'fr',
    communeId: null,
    communeScopeIds: [],
    laboratoireId: null,
    organisationId: null,
    habilitationUntil: null,
    mfaEnabled: false,
    mfaVerifiedAt: null,
    ...overrides,
  };
}

describe('RBAC Matrix & Scope Isolation (EF-01)', () => {
  const scopePolicy = new ScopePolicyService();

  it('prevents cross-commune access (Commune A cannot access Commune B)', () => {
    const agentA = makeUser({
      id: 'agent-a',
      role: Role.AGENT_COMMUNAL,
      communeId: 10,
      communeScopeIds: [10],
    });

    expect(() =>
      scopePolicy.assertCanAccessOuvrage(agentA, {
        communeId: 10,
        ownerId: 'owner-1',
        builderOrgId: null,
      }),
    ).not.toThrow();

    expect(() =>
      scopePolicy.assertCanAccessOuvrage(agentA, {
        communeId: 20,
        ownerId: 'owner-1',
        builderOrgId: null,
      }),
    ).toThrow(ForbiddenException);

    expect(scopePolicy.ouvrageWhere(agentA)).toEqual({
      communeId: { in: [10] },
    });
  });

  it('isolates PROPRIETAIRE to own ouvrages and LABORATOIRE to assigned demandes', () => {
    const ownerA = makeUser({ id: 'owner-a', role: Role.PROPRIETAIRE });
    expect(() =>
      scopePolicy.assertCanAccessOuvrage(ownerA, {
        communeId: 10,
        ownerId: 'owner-b',
        builderOrgId: null,
      }),
    ).toThrow(ForbiddenException);

    const labA = makeUser({
      id: 'lab-user-a',
      role: Role.LABORATOIRE,
      laboratoireId: 'lab-a',
    });
    expect(() =>
      scopePolicy.assertCanAccessOuvrage(labA, {
        communeId: 10,
        ownerId: 'owner-a',
        builderOrgId: null,
        demandeLabIds: ['lab-b'],
      }),
    ).toThrow(ForbiddenException);

    expect(() =>
      scopePolicy.assertCanAccessOuvrage(labA, {
        communeId: 10,
        ownerId: 'owner-a',
        builderOrgId: null,
        demandeLabIds: ['lab-a'],
      }),
    ).not.toThrow();
  });

  it('enforces @Roles() and rejects ADMIN from certification-only MINEE actions', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce([Role.MINEE]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: makeUser({ role: Role.ADMIN, mfaEnabled: true }),
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('enforces @StrongAuth() requiring TOTP verification within 10 minutes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new StrongAuthGuard(reflector);

    const staleCtx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: makeUser({
            role: Role.MINEE,
            mfaEnabled: true,
            mfaVerifiedAt: Date.now() - 11 * 60 * 1000,
          }),
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(staleCtx)).toThrow(ForbiddenException);

    const freshCtx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: makeUser({
            role: Role.MINEE,
            mfaEnabled: true,
            mfaVerifiedAt: Date.now() - 2 * 60 * 1000,
          }),
        }),
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(freshCtx)).toBe(true);
  });
});
