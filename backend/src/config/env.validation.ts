import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_NAME: z.string().min(1).default('AquaSafe'),
  CORS_ORIGINS: z.string().min(1),
  PUBLIC_VERIFY_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DEFAULT_LOCALE: z.enum(['fr', 'en']).default('fr'),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (val) => val.startsWith('postgres://') || val.startsWith('postgresql://'),
      'DATABASE_URL must be a PostgreSQL connection URI',
    ),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(300),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'TOTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    ),
  IP_HASH_SALT: z.string().min(16),

  DUPLICATE_RADIUS_M: z.coerce.number().positive().default(15),
  PUBLIC_MAP_CLUSTER_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(2000),
  PUBLIC_MAP_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(60),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
