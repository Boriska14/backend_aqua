import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CertificatStatus, OuvrageType, QrTokenStatus } from '@prisma/client';
import { I18nService, SupportedLocale } from '../../common/i18n/i18n.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PublicMapQueryDto,
  PublicOuvrageDto,
  PublicOuvragesQueryDto,
  PublicStatus,
} from './dto/public.dto';

export type VerifyState =
  'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'WITHDRAWN' | 'UNKNOWN';

interface PublicViewRow {
  ouvrageId: string;
  aquasafeNumber: string;
  name: string;
  village: string | null;
  communeName: string;
  type: OuvrageType;
  latitude: number;
  longitude: number;
  publicStatus: PublicStatus;
  certificatNumber: string | null;
  validUntil: Date | null;
  lastControlAt: Date | null;
}

@Injectable()
export class PublicService {
  private readonly mapCache = new Map<
    string,
    { expiresAt: number; data: unknown }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async verifyQr(token: string, locale: SupportedLocale) {
    const startedAt = Date.now();
    try {
      const qr = await this.prisma.qrToken.findUnique({
        where: { token },
        include: {
          certificat: {
            include: {
              ouvrage: { include: { commune: true } },
              referentiel: true,
            },
          },
        },
      });

      if (!qr || !qr.certificat || !qr.certificat.ouvrage.isPublic) {
        return this.buildVerifyResponse('UNKNOWN', null, locale);
      }

      // Follow replacedById chain to current certificate (EF-22)
      let currentCert = qr.certificat;
      const visited = new Set<string>([currentCert.id]);
      while (currentCert.replacedById && visited.size < 20) {
        if (visited.has(currentCert.replacedById)) break;
        visited.add(currentCert.replacedById);
        const nextCert = await this.prisma.certificat.findUnique({
          where: { id: currentCert.replacedById },
          include: {
            ouvrage: { include: { commune: true } },
            referentiel: true,
            qrToken: true,
          },
        });
        if (!nextCert) break;
        currentCert = nextCert;
      }

      const now = new Date();
      let state: VerifyState = 'UNKNOWN';
      if (currentCert.status === CertificatStatus.RETIRE) {
        state = 'WITHDRAWN';
      } else if (
        currentCert.status === CertificatStatus.SUSPENDU ||
        qr.status === QrTokenStatus.REVOKED
      ) {
        state = 'SUSPENDED';
      } else if (
        currentCert.status === CertificatStatus.EXPIRE ||
        (currentCert.validUntil && currentCert.validUntil < now)
      ) {
        state = 'EXPIRED';
      } else if (currentCert.status === CertificatStatus.ACTIF) {
        state = 'ACTIVE';
      } else if (currentCert.status === CertificatStatus.EMIS) {
        state = 'SUSPENDED';
      }

      return this.buildVerifyResponse(state, currentCert, locale);
    } finally {
      // Constant-time floor (~25ms) to avoid timing oracle between UNKNOWN and REVOKED
      const elapsed = Date.now() - startedAt;
      if (elapsed < 25) {
        await new Promise((resolve) => setTimeout(resolve, 25 - elapsed));
      }
    }
  }

  private buildVerifyResponse(
    state: VerifyState,
    cert: {
      number: string;
      validFrom: Date | null;
      validUntil: Date | null;
      referentiel: { code: string; version: string };
      ouvrage: {
        aquasafeNumber: string;
        name: string;
        village: string | null;
        lastControlAt: Date | null;
        commune: { name: string };
      };
    } | null,
    locale: SupportedLocale,
  ) {
    const guidanceCode = `guidance.VERIFY_${state}`;
    if (!cert || state === 'UNKNOWN') {
      return {
        state: 'UNKNOWN' as VerifyState,
        pilot: true,
        pilotNotice: this.i18n.t('pilot.banner', locale),
        ouvrage: null,
        certificat: null,
        lastControlAt: null,
        guidanceCode,
        guidanceMessage: this.i18n.t(guidanceCode, locale),
        reportUrl: '/signalements',
      };
    }

    const expiresInDays = cert.validUntil
      ? Math.ceil(
          (cert.validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : null;

    return {
      state,
      pilot: true,
      pilotNotice: this.i18n.t('pilot.banner', locale),
      ouvrage: {
        aquasafeNumber: cert.ouvrage.aquasafeNumber,
        name: cert.ouvrage.name,
        village: cert.ouvrage.village,
        communeName: cert.ouvrage.commune.name,
      },
      certificat: {
        number: cert.number,
        validFrom: cert.validFrom
          ? cert.validFrom.toISOString().slice(0, 10)
          : null,
        validUntil: cert.validUntil
          ? cert.validUntil.toISOString().slice(0, 10)
          : null,
        referentiel: `${cert.referentiel.code} ${cert.referentiel.version}`,
        expiresInDays,
      },
      lastControlAt: cert.ouvrage.lastControlAt
        ? cert.ouvrage.lastControlAt.toISOString().slice(0, 10)
        : null,
      guidanceCode,
      guidanceMessage: this.i18n.t(guidanceCode, locale),
    };
  }

  async searchOuvrages(query: PublicOuvragesQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const conditions: string[] = ['o."isPublic" = true'];
    const params: unknown[] = [];

    if (query.q) {
      params.push(`%${query.q.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(v."aquasafeNumber" ILIKE $${idx} OR v.name ILIKE $${idx} OR v."communeName" ILIKE $${idx})`,
      );
    }
    if (query.communeId) {
      params.push(query.communeId);
      conditions.push(`o."communeId" = $${params.length}`);
    }
    if (query.regionId) {
      params.push(query.regionId);
      conditions.push(`c."regionId" = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`v."publicStatus" = $${params.length}`);
    }

    const whereSql = conditions.join(' AND ');

    const countRows = await this.prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
      `SELECT COUNT(*)::bigint AS cnt
       FROM ouvrage_public_view v
       JOIN ouvrages o ON o.id = v."ouvrageId"
       JOIN communes c ON c.id = o."communeId"
       WHERE ${whereSql}`,
      ...params,
    );
    const total = Number(countRows[0]?.cnt ?? 0);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows = await this.prisma.$queryRawUnsafe<PublicViewRow[]>(
      `SELECT v.*
       FROM ouvrage_public_view v
       JOIN ouvrages o ON o.id = v."ouvrageId"
       JOIN communes c ON c.id = o."communeId"
       WHERE ${whereSql}
       ORDER BY v."aquasafeNumber" ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...params,
      take,
      skip,
    );

    return paginate(
      rows.map((r) => this.toPublicOuvrageDto(r)),
      total,
      page,
      limit,
    );
  }

  async getOuvrageByNumber(aquasafeNumber: string): Promise<PublicOuvrageDto> {
    const rows = await this.prisma.$queryRaw<PublicViewRow[]>`
      SELECT v.*
      FROM ouvrage_public_view v
      JOIN ouvrages o ON o.id = v."ouvrageId"
      WHERE v."aquasafeNumber" = ${aquasafeNumber}
        AND o."isPublic" = true
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Public water point not found',
      });
    }
    return this.toPublicOuvrageDto(rows[0]);
  }

  async getMapGeoJson(query: PublicMapQueryDto) {
    const cacheKey = JSON.stringify(query);
    const cached = this.mapCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const parts = query.bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'bbox must be minLng,minLat,maxLng,maxLat',
      });
    }
    const [minLng, minLat, maxLng, maxLat] = parts;

    const conditions: string[] = [
      'o."isPublic" = true',
      'v.longitude BETWEEN $1 AND $3',
      'v.latitude BETWEEN $2 AND $4',
    ];
    const params: unknown[] = [minLng, minLat, maxLng, maxLat];

    if (query.status) {
      params.push(query.status);
      conditions.push(`v."publicStatus" = $${params.length}`);
    }
    if (query.type) {
      params.push(query.type);
      conditions.push(`v.type = $${params.length}::"OuvrageType"`);
    }
    if (query.communeId) {
      params.push(query.communeId);
      conditions.push(`o."communeId" = $${params.length}`);
    }
    if (query.controlledSince) {
      params.push(new Date(query.controlledSince));
      conditions.push(`v."lastControlAt" >= $${params.length}`);
    }

    const whereSql = conditions.join(' AND ');
    const threshold = this.configService.get<number>(
      'PUBLIC_MAP_CLUSTER_THRESHOLD',
      2000,
    );

    const countRows = await this.prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
      `SELECT COUNT(*)::bigint AS cnt
       FROM ouvrage_public_view v
       JOIN ouvrages o ON o.id = v."ouvrageId"
       WHERE ${whereSql}`,
      ...params,
    );
    const count = Number(countRows[0]?.cnt ?? 0);

    let geojson: unknown;
    if (count > threshold) {
      const gridStep = Math.max(0.02, (maxLng - minLng) / 25);
      const cellIdx = params.length + 1;
      const clusters = await this.prisma.$queryRawUnsafe<
        Array<{ lng: number; lat: number; point_count: bigint }>
      >(
        `SELECT
           AVG(v.longitude)::float8 AS lng,
           AVG(v.latitude)::float8 AS lat,
           COUNT(*)::bigint AS point_count
         FROM ouvrage_public_view v
         JOIN ouvrages o ON o.id = v."ouvrageId"
         WHERE ${whereSql}
         GROUP BY FLOOR(v.longitude / $${cellIdx}), FLOOR(v.latitude / $${cellIdx})`,
        ...params,
        gridStep,
      );
      geojson = {
        type: 'FeatureCollection',
        clustered: true,
        features: clusters.map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
          properties: {
            cluster: true,
            pointCount: Number(c.point_count),
          },
        })),
      };
    } else {
      const rows = await this.prisma.$queryRawUnsafe<PublicViewRow[]>(
        `SELECT v.*
         FROM ouvrage_public_view v
         JOIN ouvrages o ON o.id = v."ouvrageId"
         WHERE ${whereSql}
         LIMIT ${threshold}`,
        ...params,
      );
      geojson = {
        type: 'FeatureCollection',
        clustered: false,
        features: rows.map((r) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number(r.longitude), Number(r.latitude)],
          },
          properties: this.toPublicOuvrageDto(r),
        })),
      };
    }

    const ttlMs =
      this.configService.get<number>('PUBLIC_MAP_CACHE_TTL_SECONDS', 60) * 1000;
    if (ttlMs > 0) {
      this.mapCache.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        data: geojson,
      });
    }

    return geojson;
  }

  async getStats() {
    const [ouvragesRecenses, ouvragesCertifies, analysesRealisees, communes] =
      await Promise.all([
        this.prisma.ouvrage.count({ where: { isPublic: true } }),
        this.prisma.certificat.count({
          where: { status: CertificatStatus.ACTIF },
        }),
        this.prisma.analyseResultat.count({
          where: { status: { in: ['SOUMISE', 'AMENDEE'] } },
        }),
        this.prisma.ouvrage.groupBy({
          by: ['communeId'],
          where: { isPublic: true },
        }),
      ]);

    return {
      pilot: 'Pilote en cours de validation',
      ouvragesRecenses,
      ouvragesCertifies,
      analysesRealisees,
      communesCouvertes: communes.length,
      updatedAt: new Date().toISOString(),
    };
  }

  private toPublicOuvrageDto(r: PublicViewRow): PublicOuvrageDto {
    // Strict whitelist: NEVER expose owner, phone, email, or payment amounts
    return {
      aquasafeNumber: r.aquasafeNumber,
      name: r.name,
      village: r.village,
      communeName: r.communeName,
      type: r.type,
      publicStatus: r.publicStatus,
      validUntil: r.validUntil ? r.validUntil.toISOString().slice(0, 10) : null,
      lastControlAt: r.lastControlAt
        ? r.lastControlAt.toISOString().slice(0, 10)
        : null,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    };
  }
}
