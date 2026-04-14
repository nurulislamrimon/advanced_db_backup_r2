import {
  AppConfig,
  BackupConfig,
  DatabaseConfig,
  R2Config,
  AlertConfig,
  RetentionConfig,
  RedisConfig,
} from '../types';
import * as fs from 'fs';

function getEnv(key: string, required = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || '';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  const parsed = parseInt(value || '', 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): AppConfig {
  const db: DatabaseConfig = {
    host: getEnv('POSTGRES_HOST'),
    port: getEnvNumber('POSTGRES_PORT', 5432),
    username: getEnv('POSTGRES_USER'),
    password: getEnv('POSTGRES_PASSWORD'),
    database: getEnv('POSTGRES_DB'),
  };

  const r2: R2Config = {
    endpoint: getEnv('R2_ENDPOINT'),
    accessKey: getEnv('R2_ACCESS_KEY'),
    secretKey: getEnv('R2_SECRET_KEY'),
    bucket: getEnv('R2_BUCKET'),
  };

  const retention: RetentionConfig = {
    daily: getEnvNumber('RETENTION_DAILY', 7),
    weekly: getEnvNumber('RETENTION_WEEKLY', 4),
    monthly: getEnvNumber('RETENTION_MONTHLY', 6),
  };

  const backup: BackupConfig = {
    schedule: getEnv('BACKUP_SCHEDULE', false) || '0 2 * * *',
    retention,
    tempDir: getEnv('TEMP_DIR', false) || '/tmp',
    enableEncryption: getEnv('ENABLE_ENCRYPTION', false) === 'true',
    encryptionKey: getEnv('ENCRYPTION_KEY', false) || undefined,
  };

  const redis: RedisConfig = {
    host: getEnv('REDIS_HOST', false) || 'localhost',
    port: getEnvNumber('REDIS_PORT', 6379),
  };

  let alert: AlertConfig | undefined;
  if (getEnv('ALERT_WEBHOOK', false) || getEnv('ALERT_EMAIL', false)) {
    alert = {
      type: (getEnv('ALERT_TYPE', false) as 'email' | 'webhook') || 'webhook',
      url: getEnv('ALERT_WEBHOOK', false) || getEnv('ALERT_EMAIL', false) || '',
      enabled: true,
    };
  }

  return { db, r2, backup, redis, alert };
}

export function getLastBackupTime(): number | null {
  const lastBackupPath = `${process.env.TEMP_DIR || '/tmp'}/last_backup_timestamp`;
  try {
    if (fs.existsSync(lastBackupPath)) {
      const timestamp = parseInt(fs.readFileSync(lastBackupPath, 'utf-8'), 10);
      return isNaN(timestamp) ? null : timestamp;
    }
  } catch {
    return null;
  }
  return null;
}

export function setLastBackupTime(timestamp: number): void {
  const lastBackupPath = `${process.env.TEMP_DIR || '/tmp'}/last_backup_timestamp`;
  try {
    fs.writeFileSync(lastBackupPath, timestamp.toString());
  } catch {
    // Silently fail
  }
}
