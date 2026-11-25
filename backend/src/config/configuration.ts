import { EnvConfig } from './env.validation';

export interface AppConfiguration {
  nodeEnv: EnvConfig['NODE_ENV'];
  port: number;
  appName: string;
  corsOrigins: string[];
  publicVerifyUrl: string;
  logLevel: EnvConfig['LOG_LEVEL'];
  defaultLocale: EnvConfig['DEFAULT_LOCALE'];
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
    maxUploadMb: number;
    signedUrlTtlSeconds: number;
  };
  auth: {
    jwtAccessSecret: string;
    jwtAccessTtlSeconds: number;
    jwtRefreshSecret: string;
    jwtRefreshTtlDays: number;
    totpEncryptionKey: string;
    ipHashSalt: string;
  };
  pilot: {
    duplicateRadiusM: number;
    publicMapClusterThreshold: number;
    publicMapCacheTtlSeconds: number;
  };
}

export function buildAppConfiguration(env: EnvConfig): AppConfiguration {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appName: env.APP_NAME,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    publicVerifyUrl: env.PUBLIC_VERIFY_URL,
    logLevel: env.LOG_LEVEL,
    defaultLocale: env.DEFAULT_LOCALE,
    databaseUrl: env.DATABASE_URL,
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      maxUploadMb: env.MAX_UPLOAD_MB,
      signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
    },
    auth: {
      jwtAccessSecret: env.JWT_ACCESS_SECRET,
      jwtAccessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      jwtRefreshSecret: env.JWT_REFRESH_SECRET,
      jwtRefreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
      totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
      ipHashSalt: env.IP_HASH_SALT,
    },
    pilot: {
      duplicateRadiusM: env.DUPLICATE_RADIUS_M,
      publicMapClusterThreshold: env.PUBLIC_MAP_CLUSTER_THRESHOLD,
      publicMapCacheTtlSeconds: env.PUBLIC_MAP_CACHE_TTL_SECONDS,
    },
  };
}
