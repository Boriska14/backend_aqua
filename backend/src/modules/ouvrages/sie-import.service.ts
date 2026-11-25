import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OuvrageType,
  OuvrageUsage,
  SieImportStatus,
  UserStatus,
  Role,
} from '@prisma/client';
import { parse } from 'csv-parse';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { AuthUser } from '../../common/types/auth-user.type';
import { normalizeCameroonPhone } from '../../common/utils/crypto.util';
import { SystemParamsService } from '../../common/utils/system-params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface SieColumnMapper {
  sieId: string;
  name: string;
  type: string;
  usage: string;
  village: string;
  communeCode: string;
  latitude: string;
  longitude: string;
  yearBuilt: string;
  ownerPhone: string;
}

const DEFAULT_SIE_MAPPER: SieColumnMapper = {
  sieId: 'sieId',
  name: 'name',
  type: 'type',
  usage: 'usage',
  village: 'village',
  communeCode: 'communeCode',
  latitude: 'latitude',
  longitude: 'longitude',
  yearBuilt: 'yearBuilt',
  ownerPhone: 'ownerPhone',
};

interface SieRowError {
  row: number;
  field: string;
  message: string;
}

@Injectable()
export class SieImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly systemParams: SystemParamsService,
  ) {}

  async importFile(
    user: AuthUser,
    file: Express.Multer.File,
    dryRun = false,
    mapperOverrideRaw?: string,
    ip?: string | null,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Import file (CSV or XLSX) is required',
      });
    }

    let mapper = { ...DEFAULT_SIE_MAPPER };
    if (mapperOverrideRaw) {
      try {
        const parsed = JSON.parse(
          mapperOverrideRaw,
        ) as Partial<SieColumnMapper>;
        mapper = { ...mapper, ...parsed };
      } catch {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'columnMapper must be valid JSON',
        });
      }
    }

    const job = await this.prisma.sieImportHistory.create({
      data: {
        uploadedById: user.id,
        filename: file.originalname || 'sie-import',
        dryRun,
        status: SieImportStatus.RUNNING,
      },
    });

    try {
      const rows = await this.parseRows(file);
      const errors: SieRowError[] = [];
      let createdRows = 0;
      let updatedRows = 0;
      let skippedRows = 0;

      const prefix = await this.systemParams.getString(
        'ouvrageNumberPrefix',
        'AS',
      );

      const BATCH_SIZE = 500;
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);

        await this.prisma.$transaction(async (tx) => {
          for (let i = 0; i < batch.length; i++) {
            const rowNum = offset + i + 2; // 1-based + header
            const raw = batch[i];

            const sieId = this.str(raw[mapper.sieId]);
            const name = this.str(raw[mapper.name]);
            const lat = Number(raw[mapper.latitude]);
            const lng = Number(raw[mapper.longitude]);
            const rawType = this.str(raw[mapper.type])?.toUpperCase();
            const rawUsage = this.str(raw[mapper.usage])?.toUpperCase();
            const communeCode = this.str(raw[mapper.communeCode]);
            const village = this.str(raw[mapper.village]);
            const yearBuiltRaw = raw[mapper.yearBuilt]
              ? Number(raw[mapper.yearBuilt])
              : null;
            const rawOwnerPhone = this.str(raw[mapper.ownerPhone]);

            if (!sieId) {
              errors.push({
                row: rowNum,
                field: mapper.sieId,
                message: 'Missing sieId',
              });
              continue;
            }
            if (!name) {
              errors.push({
                row: rowNum,
                field: mapper.name,
                message: 'Missing name',
              });
              continue;
            }
            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              lat < 1.6 ||
              lat > 13.1 ||
              lng < 8.4 ||
              lng > 16.2
            ) {
              errors.push({
                row: rowNum,
                field: 'coordinates',
                message: 'Coordinates outside Cameroon bounding box',
              });
              continue;
            }

            const ouvrageType: OuvrageType =
              rawType === 'PUITS_AMENAGE' || rawType === 'PUITS'
                ? OuvrageType.PUITS_AMENAGE
                : OuvrageType.FORAGE;

            const usage: OuvrageUsage =
              rawUsage && rawUsage in OuvrageUsage
                ? (rawUsage as OuvrageUsage)
                : OuvrageUsage.COMMUNAUTAIRE;

            let commune: { id: number; region: { code: string } } | null = null;
            if (communeCode) {
              commune = await tx.commune.findUnique({
                where: { code: communeCode },
                include: { region: { select: { code: true } } },
              });
            }
            if (!commune) {
              const foundByPoly = await tx.$queryRaw<
                Array<{ id: number; region_code: string }>
              >`
                SELECT c.id, r.code AS region_code
                FROM communes c
                JOIN regions r ON r.id = c."regionId"
                WHERE c.boundary IS NOT NULL
                  AND ST_Contains(c.boundary, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
                LIMIT 1
              `;
              if (foundByPoly.length > 0) {
                commune = {
                  id: foundByPoly[0].id,
                  region: { code: foundByPoly[0].region_code },
                };
              }
            }

            if (!commune) {
              errors.push({
                row: rowNum,
                field: mapper.communeCode,
                message: 'Commune not found by code or ST_Contains',
              });
              continue;
            }

            let ownerId: string | null = null;
            if (rawOwnerPhone) {
              const normalized = normalizeCameroonPhone(rawOwnerPhone);
              if (!normalized) {
                errors.push({
                  row: rowNum,
                  field: mapper.ownerPhone,
                  message: 'Invalid E.164 phone number',
                });
                continue;
              }
              if (!dryRun) {
                let owner = await tx.user.findUnique({
                  where: { phone: normalized },
                });
                if (!owner) {
                  owner = await tx.user.create({
                    data: {
                      role: Role.PROPRIETAIRE,
                      status: UserStatus.PENDING,
                      fullName: 'Propriétaire SIE',
                      phone: normalized,
                    },
                  });
                }
                ownerId = owner.id;
              }
            }

            const existing = await tx.ouvrage.findUnique({
              where: { sieId },
            });

            if (existing) {
              const unchanged =
                existing.name === name &&
                existing.communeId === commune.id &&
                Math.abs(existing.latitude - lat) < 1e-6 &&
                Math.abs(existing.longitude - lng) < 1e-6 &&
                existing.type === ouvrageType;

              if (unchanged) {
                skippedRows++;
                continue;
              }

              if (!dryRun) {
                await tx.ouvrage.update({
                  where: { id: existing.id },
                  data: {
                    name,
                    village,
                    type: ouvrageType,
                    usage,
                    communeId: commune.id,
                    latitude: lat,
                    longitude: lng,
                    ...(yearBuiltRaw ? { yearBuilt: yearBuiltRaw } : {}),
                    ...(ownerId ? { ownerId } : {}),
                  },
                });
              }
              updatedRows++;
            } else {
              if (!dryRun) {
                const seqRows = await tx.$queryRaw<Array<{ val: bigint }>>`
                  SELECT nextval('seq_ouvrage') AS val
                `;
                const seqStr = String(seqRows[0].val).padStart(6, '0');
                const aquasafeNumber = `${prefix}-${commune.region.code}-${seqStr}`;
                await tx.ouvrage.create({
                  data: {
                    aquasafeNumber,
                    sieId,
                    name,
                    village,
                    type: ouvrageType,
                    usage,
                    communeId: commune.id,
                    latitude: lat,
                    longitude: lng,
                    yearBuilt: yearBuiltRaw,
                    ownerId,
                    dossier: { create: {} },
                  },
                });
              }
              createdRows++;
            }
          }
        });
      }

      const finished = await this.prisma.sieImportHistory.update({
        where: { id: job.id },
        data: {
          status: SieImportStatus.DONE,
          totalRows: rows.length,
          createdRows,
          updatedRows,
          skippedRows,
          errorRows: errors.length,
          errorReport: errors as unknown as object,
          finishedAt: new Date(),
        },
      });

      await this.auditService.log(this.prisma, {
        actorId: user.id,
        actorRole: user.role,
        action: 'SIE_IMPORT_COMPLETED',
        entityType: 'SieImportHistory',
        entityId: job.id,
        after: {
          dryRun,
          totalRows: rows.length,
          createdRows,
          updatedRows,
          skippedRows,
          errorRows: errors.length,
        },
        ip,
      });

      return this.formatJob(finished);
    } catch (err) {
      const failed = await this.prisma.sieImportHistory.update({
        where: { id: job.id },
        data: {
          status: SieImportStatus.FAILED,
          errorReport: [
            {
              row: 0,
              field: 'file',
              message: err instanceof Error ? err.message : 'Import failed',
            },
          ],
          finishedAt: new Date(),
        },
      });
      return this.formatJob(failed);
    }
  }

  async getJob(jobId: string) {
    const job = await this.prisma.sieImportHistory.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Import job not found',
      });
    }
    return this.formatJob(job);
  }

  private formatJob(job: {
    id: string;
    status: SieImportStatus;
    totalRows: number;
    createdRows: number;
    updatedRows: number;
    skippedRows: number;
    errorRows: number;
    errorReport: unknown;
  }) {
    return {
      id: job.id,
      status: job.status,
      totalRows: job.totalRows,
      createdRows: job.createdRows,
      updatedRows: job.updatedRows,
      skippedRows: job.skippedRows,
      errorRows: job.errorRows,
      errors: Array.isArray(job.errorReport) ? job.errorReport : [],
    };
  }

  private async parseRows(
    file: Express.Multer.File,
  ): Promise<Array<Record<string, unknown>>> {
    const filename = (file.originalname || '').toLowerCase();
    if (filename.endsWith('.xlsx')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        return [];
      }
      const headers: string[] = [];
      const rows: Array<Record<string, unknown>> = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, colNumber) => {
            headers[colNumber] = String(cell.value ?? '').trim();
          });
        } else {
          const obj: Record<string, unknown> = {};
          headers.forEach((h, idx) => {
            if (h) {
              obj[h] = row.getCell(idx).value;
            }
          });
          rows.push(obj);
        }
      });
      return rows;
    }

    return new Promise((resolve, reject) => {
      const records: Array<Record<string, unknown>> = [];
      const parser = parse({
        columns: true,
        trim: true,
        skip_empty_lines: true,
        bom: true,
      });
      parser.on('readable', () => {
        let record: Record<string, unknown> | null;
        while (
          (record = parser.read() as Record<string, unknown> | null) !== null
        ) {
          records.push(record);
        }
      });
      parser.on('error', reject);
      parser.on('end', () => resolve(records));
      Readable.from(file.buffer).pipe(parser);
    });
  }

  private str(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
