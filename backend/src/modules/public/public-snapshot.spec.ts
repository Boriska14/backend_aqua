import { ConfigService } from '@nestjs/config';
import { CertificatStatus, OuvrageType, QrTokenStatus } from '@prisma/client';
import { I18nService } from '../../common/i18n/i18n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicStatus } from './dto/public.dto';
import { PublicService } from './public.service';

const FORBIDDEN_PUBLIC_KEYS = [
  'owner',
  'ownerId',
  'phone',
  'ownerPhone',
  'contactPhone',
  'email',
  'amount',
  'tarifAmount',
  'amountPaid',
  'subventionAmount',
  'passwordHash',
  'encryptedSecret',
];

function assertNoForbiddenKeys(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const key of FORBIDDEN_PUBLIC_KEYS) {
    expect(serialized).not.toContain(`"${key}"`);
  }
}

describe('PublicService (EF-06, EF-22, EF-23, EF-24)', () => {
  const configService = {
    get: jest.fn((_k: string, fallback: unknown) => fallback),
  } as unknown as ConfigService;
  const i18n = new I18nService(configService);

  it('returns UNKNOWN state for unknown token without leaking private keys', async () => {
    const prisma = {
      qrToken: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new PublicService(prisma, configService, i18n);

    const res = await service.verifyQr('unknownToken123456789012', 'fr');
    expect(res.state).toBe('UNKNOWN');
    expect(res.pilot).toBe(true);
    expect(res.pilotNotice).toBe('Pilote en cours de validation');
    expect(res.ouvrage).toBeNull();
    assertNoForbiddenKeys(res);
  });

  it('follows replacedById chain on renewal and resolves current ACTIVE certificate (EF-22)', async () => {
    const oldCert = {
      id: 'cert-old',
      number: 'CC-2025-000001',
      status: CertificatStatus.REMPLACE,
      replacedById: 'cert-new',
      validFrom: new Date('2025-01-01'),
      validUntil: new Date('2026-01-01'),
      referentiel: { code: 'NC-207', version: 'v1' },
      ouvrage: {
        aquasafeNumber: 'AS-CE-000001',
        name: 'Forage Mfoundi',
        village: 'Bastos',
        isPublic: true,
        lastControlAt: new Date('2026-01-10'),
        ownerId: 'secret-owner-uuid',
        commune: { name: 'Yaoundé 1er' },
      },
    };
    const newCert = {
      id: 'cert-new',
      number: 'CC-2026-000010',
      status: CertificatStatus.ACTIF,
      replacedById: null,
      validFrom: new Date('2026-01-15'),
      validUntil: new Date('2099-01-15'),
      referentiel: { code: 'NC-207', version: 'v2' },
      ouvrage: oldCert.ouvrage,
      qrToken: { status: QrTokenStatus.ACTIVE },
    };

    const prisma = {
      qrToken: {
        findUnique: jest.fn().mockResolvedValue({
          token: 'oldQrToken12345678901234',
          status: QrTokenStatus.ACTIVE,
          certificat: oldCert,
        }),
      },
      certificat: {
        findUnique: jest.fn().mockResolvedValue(newCert),
      },
    } as unknown as PrismaService;

    const service = new PublicService(prisma, configService, i18n);
    const res = await service.verifyQr('oldQrToken12345678901234', 'fr');

    expect(res.state).toBe('ACTIVE');
    expect(res.certificat?.number).toBe('CC-2026-000010');
    expect(res.guidanceMessage).toContain('certificat de conformité');
    assertNoForbiddenKeys(res);
  });

  it('maps SUSPENDED, EXPIRED, and WITHDRAWN states accurately', async () => {
    const baseOuvrage = {
      aquasafeNumber: 'AS-LT-000042',
      name: 'Puits Bonaberi',
      village: null,
      isPublic: true,
      lastControlAt: null,
      commune: { name: 'Douala 4e' },
    };

    const cases: Array<{
      certStatus: CertificatStatus;
      qrStatus: QrTokenStatus;
      expected: string;
    }> = [
      {
        certStatus: CertificatStatus.SUSPENDU,
        qrStatus: QrTokenStatus.REVOKED,
        expected: 'SUSPENDED',
      },
      {
        certStatus: CertificatStatus.EXPIRE,
        qrStatus: QrTokenStatus.ACTIVE,
        expected: 'EXPIRED',
      },
      {
        certStatus: CertificatStatus.RETIRE,
        qrStatus: QrTokenStatus.REVOKED,
        expected: 'WITHDRAWN',
      },
    ];

    for (const c of cases) {
      const prisma = {
        qrToken: {
          findUnique: jest.fn().mockResolvedValue({
            token: 'token1234567890123456789',
            status: c.qrStatus,
            certificat: {
              id: 'cert-1',
              number: 'CC-2026-000099',
              status: c.certStatus,
              replacedById: null,
              validFrom: new Date('2026-01-01'),
              validUntil: new Date('2027-01-01'),
              referentiel: { code: 'NC-207', version: 'v1' },
              ouvrage: baseOuvrage,
            },
          }),
        },
      } as unknown as PrismaService;
      const service = new PublicService(prisma, configService, i18n);
      const res = await service.verifyQr('token1234567890123456789', 'en');
      expect(res.state).toBe(c.expected);
      assertNoForbiddenKeys(res);
    }
  });

  it('never leaks blacklisted keys in public ouvrage DTO', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          ouvrageId: 'ouv-1',
          aquasafeNumber: 'AS-CE-000001',
          name: 'Forage Test',
          village: 'Etoudi',
          communeName: 'Yaoundé 1er',
          type: OuvrageType.FORAGE,
          latitude: 3.9,
          longitude: 11.5,
          publicStatus: PublicStatus.CERTIFIE,
          certificatNumber: 'CC-2026-000001',
          validUntil: new Date('2027-01-01'),
          lastControlAt: new Date('2026-01-01'),
          ownerId: 'should-never-appear',
          phone: '+237699999999',
        },
      ]),
    } as unknown as PrismaService;

    const service = new PublicService(prisma, configService, i18n);
    const dto = await service.getOuvrageByNumber('AS-CE-000001');
    assertNoForbiddenKeys(dto);
    expect(dto).toEqual({
      aquasafeNumber: 'AS-CE-000001',
      name: 'Forage Test',
      village: 'Etoudi',
      communeName: 'Yaoundé 1er',
      type: OuvrageType.FORAGE,
      publicStatus: PublicStatus.CERTIFIE,
      validUntil: '2027-01-01',
      lastControlAt: '2026-01-01',
      latitude: 3.9,
      longitude: 11.5,
    });
  });
});
