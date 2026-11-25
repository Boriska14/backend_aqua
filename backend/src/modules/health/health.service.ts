import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  pilot: string;
  checks: {
    database: 'up' | 'down';
    storage: 'up' | 'down';
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.getOrThrow<string>('S3_BUCKET');
    this.s3Client = new S3Client({
      endpoint: this.configService.getOrThrow<string>('S3_ENDPOINT'),
      region: this.configService.getOrThrow<string>('S3_REGION'),
      forcePathStyle: this.configService.get<boolean>('S3_FORCE_PATH_STYLE', true),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.configService.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  async check(): Promise<HealthCheckResult> {
    const [dbUp, storageUp] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
    ]);

    const result: HealthCheckResult = {
      status: dbUp && storageUp ? 'ok' : 'degraded',
      pilot: 'Pilote en cours de validation',
      checks: {
        database: dbUp ? 'up' : 'down',
        storage: storageUp ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    };

    if (!dbUp || !storageUp) {
      throw new ServiceUnavailableException({
        code: 'HEALTH_DEGRADED',
        detail: 'Database or object storage is unavailable',
        ...result,
      });
    }

    return result;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      return await this.prisma.ping();
    } catch {
      return false;
    }
  }

  private async checkStorage(): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
