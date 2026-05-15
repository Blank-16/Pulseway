import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

const postgresUrl = z.string().refine(
  (v) => /^postgres(?:ql)?:\/\/.+/.test(v),
  { message: 'DATABASE_URL must be a valid postgresql:// URL' },
);

const redisUrl = z.string().refine(
  (v) => /^rediss?:\/\//.test(v),
  { message: 'REDIS_URL must be a valid redis:// or rediss:// URL' },
);

const EnvSchema = z.object({
  NODE_ENV                               : z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL                           : postgresUrl,
  REDIS_URL                              : redisUrl,
  AWS_REGION                             : z.string().default('us-east-1'),
  AWS_ENDPOINT_URL                       : z.string().url().optional(),
  CHECK_JOBS_QUEUE_URL                   : z.string().url(),
  ALERT_JOBS_QUEUE_URL                   : z.string().url(),
  JWT_SECRET                             : z.string().min(32),
  JWT_EXPIRY_SECONDS                     : z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_EXPIRY_DAYS              : z.coerce.number().int().min(1).max(90).default(7),
  STRIPE_SECRET_KEY                      : z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET                  : z.string().startsWith('whsec_'),
  STRIPE_PRICE_PRO_MONTHLY               : z.string().startsWith('price_'),
  STRIPE_PRICE_TEAM_MONTHLY              : z.string().startsWith('price_'),
  SES_FROM_ADDRESS                       : z.string().email(),
  API_PORT                               : z.coerce.number().int().min(1024).max(65535).default(4000),
  SCHEDULER_POLL_INTERVAL_MS             : z.coerce.number().int().min(1000).default(10_000),
  WORKER_SQS_POLL_INTERVAL_MS            : z.coerce.number().int().min(100).default(1_000),
  WORKER_MAX_CONCURRENCY                 : z.coerce.number().int().min(1).max(100).default(10),
  INCIDENT_CONSECUTIVE_FAILURES_REQUIRED : z.coerce.number().int().min(1).max(10).default(3),
  LOG_LEVEL                              : z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT            : z.string().url().optional(),
  OTEL_SERVICE_NAME                      : z.string().optional(),
  // Optional — if set, /metrics requires this token as Bearer authorization.
  // Must be set in production; omitting it in dev allows unauthenticated scraping.
  METRICS_TOKEN                          : z.string().min(32).optional(),
  APP_ORIGIN                             : z.string().url().default('https://app.pulseway.dev'),
  SSE_MAX_CONNECTIONS_PER_WORKSPACE      : z.coerce.number().int().min(1).default(50),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cachedConfig: AppConfig | null = null;

async function loadSecretsFromAws(): Promise<Record<string, string>> {
  const client = new SecretsManagerClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  const env    = process.env['NODE_ENV'] ?? 'production';
  const prefix = `pulseway/${env}`;

  const secretNames = [
    'database-url', 'redis-url', 'jwt-secret',
    'stripe-secret-key', 'stripe-webhook-sig', 'metrics-token',
  ];
  const envKeyMap: Record<string, string> = {
    'database-url'      : 'DATABASE_URL',
    'redis-url'         : 'REDIS_URL',
    'jwt-secret'        : 'JWT_SECRET',
    'stripe-secret-key' : 'STRIPE_SECRET_KEY',
    'stripe-webhook-sig': 'STRIPE_WEBHOOK_SECRET',
    'metrics-token'     : 'METRICS_TOKEN',
  };

  const results = await Promise.allSettled(
    secretNames.map(async (name) => {
      const cmd = new GetSecretValueCommand({ SecretId: `${prefix}/${name}` });
      const res = await client.send(cmd);
      return { key: envKeyMap[name]!, value: res.SecretString ?? '' };
    }),
  );

  return Object.fromEntries(
    results
      .filter((r): r is PromiseFulfilledResult<{ key: string; value: string }> => r.status === 'fulfilled')
      .map((r) => [r.value.key, r.value.value]),
  );
}

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;

  const env    = process.env['NODE_ENV'] ?? 'development';
  const rawEnv = { ...process.env };

  if (env === 'production') {
    const secrets = await loadSecretsFromAws();
    Object.assign(rawEnv, secrets);
  }

  const parsed = EnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    throw new Error(`Config validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) throw new Error('Config not loaded. Call loadConfig() first.');
  return cachedConfig;
}
