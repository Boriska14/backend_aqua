import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { sha256Hex } from '../../common/utils/crypto.util';

export type AllowedMimeType =
  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

const EXT_MAP: Record<AllowedMimeType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly maxUploadBytes: number;
  private readonly signedUrlTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>('S3_BUCKET');
    this.maxUploadBytes =
      this.configService.get<number>('MAX_UPLOAD_MB', 10) * 1024 * 1024;
    this.signedUrlTtlSeconds = this.configService.get<number>(
      'SIGNED_URL_TTL_SECONDS',
      300,
    );
    this.s3Client = new S3Client({
      endpoint: this.configService.getOrThrow<string>('S3_ENDPOINT'),
      region: this.configService.getOrThrow<string>('S3_REGION'),
      forcePathStyle: this.configService.get<boolean>(
        'S3_FORCE_PATH_STYLE',
        true,
      ),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.configService.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  detectRealMime(buffer: Buffer): AllowedMimeType | null {
    if (buffer.length < 12) {
      return null;
    }
    // PDF: %PDF-
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      return 'application/pdf';
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    // WebP: RIFF....WEBP
    if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    return null;
  }

  async uploadBuffer(
    buffer: Buffer,
    allowedMimes: AllowedMimeType[] = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ],
    prefix = 'documents',
    maxBytesOverride?: number,
  ): Promise<{
    objectKey: string;
    mimeType: AllowedMimeType;
    sizeBytes: number;
    sha256: string;
  }> {
    const maxAllowed = maxBytesOverride ?? this.maxUploadBytes;
    if (buffer.length > maxAllowed) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `File exceeds limit of ${maxAllowed} bytes`,
      });
    }

    const detected = this.detectRealMime(buffer);
    if (!detected || !allowedMimes.includes(detected)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Unsupported or forged file type',
      });
    }

    const objectKey = `${prefix}/${randomUUID()}.${EXT_MAP[detected]}`;
    const sha256 = sha256Hex(buffer);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: detected,
        Metadata: { sha256 },
      }),
    );

    return {
      objectKey,
      mimeType: detected,
      sizeBytes: buffer.length,
      sha256,
    };
  }

  async createSignedDownloadUrl(objectKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    return getSignedUrl(this.s3Client, command, {
      expiresIn: this.signedUrlTtlSeconds,
    });
  }

  async uploadExportJson(buffer: Buffer): Promise<{
    objectKey: string;
    sizeBytes: number;
    sha256: string;
    signedUrl: string;
  }> {
    const objectKey = `exports/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.json`;
    const sha256 = sha256Hex(buffer);
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: 'application/json; charset=utf-8',
        Metadata: { sha256 },
      }),
    );
    const signedUrl = await this.createSignedDownloadUrl(objectKey);
    return {
      objectKey,
      sizeBytes: buffer.length,
      sha256,
      signedUrl,
    };
  }
}
