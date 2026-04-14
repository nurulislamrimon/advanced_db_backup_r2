import { loadConfig, getLastBackupTime, setLastBackupTime } from '../config/index';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

const TEST_FILE = path.join(tmpdir(), 'last_backup_timestamp');

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'testuser',
      POSTGRES_PASSWORD: 'testpass',
      POSTGRES_DB: 'testdb',
      R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
      R2_ACCESS_KEY: 'test-key',
      R2_SECRET_KEY: 'test-secret',
      R2_BUCKET: 'test-bucket',
      BACKUP_SCHEDULE: '0 2 * * *',
      RETENTION_DAILY: '7',
      RETENTION_WEEKLY: '4',
      RETENTION_MONTHLY: '6',
      TEMP_DIR: tmpdir(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load database config', () => {
      const config = loadConfig();
      expect(config.db.host).toBe('localhost');
      expect(config.db.port).toBe(5432);
      expect(config.db.username).toBe('testuser');
      expect(config.db.password).toBe('testpass');
      expect(config.db.database).toBe('testdb');
    });

    it('should load R2 config', () => {
      const config = loadConfig();
      expect(config.r2.endpoint).toBe('https://test.r2.cloudflarestorage.com');
      expect(config.r2.accessKey).toBe('test-key');
      expect(config.r2.secretKey).toBe('test-secret');
      expect(config.r2.bucket).toBe('test-bucket');
    });

    it('should load backup config with defaults', () => {
      delete process.env.BACKUP_SCHEDULE;
      const config = loadConfig();
      expect(config.backup.schedule).toBe('0 2 * * *');
      expect(config.backup.retention.daily).toBe(7);
      expect(config.backup.retention.weekly).toBe(4);
      expect(config.backup.retention.monthly).toBe(6);
    });

    it('should throw error for missing required env vars', () => {
      delete process.env.POSTGRES_HOST;
      expect(() => loadConfig()).toThrow('Missing required environment variable: POSTGRES_HOST');
    });
  });

  describe('getLastBackupTime / setLastBackupTime', () => {
    beforeEach(() => {
      if (fs.existsSync(TEST_FILE)) {
        fs.unlinkSync(TEST_FILE);
      }
    });

    it('should return null when no timestamp file exists', () => {
      const result = getLastBackupTime();
      expect(result).toBeNull();
    });

    it('should save and retrieve timestamp', () => {
      if (fs.existsSync(TEST_FILE)) {
        fs.unlinkSync(TEST_FILE);
      }
      const testTime = Date.now();
      setLastBackupTime(testTime);
      const result = getLastBackupTime();
      expect(result).toBe(testTime);
    });
  });
});
