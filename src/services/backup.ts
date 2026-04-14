import { spawn } from 'child_process';
import {
  createWriteStream,
  createReadStream,
  existsSync,
  statSync,
  unlinkSync,
  renameSync,
} from 'fs';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { DatabaseConfig, BackupResult } from '../types';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

export class BackupService {
  private dbConfig: DatabaseConfig;
  private tempDir: string;
  private enableEncryption: boolean;
  private encryptionKey?: string;

  constructor(
    dbConfig: DatabaseConfig,
    tempDir: string,
    enableEncryption = false,
    encryptionKey?: string
  ) {
    this.dbConfig = dbConfig;
    this.tempDir = tempDir;
    this.enableEncryption = enableEncryption;
    this.encryptionKey = encryptionKey;
  }

  async executeBackup(): Promise<BackupResult> {
    const startTime = Date.now();
    const timestamp = Date.now();
    const timestampStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${timestampStr}.sql.gz`;
    const filepath = `${this.tempDir}/${filename}`;

    logger.info('Starting backup process', { filename, timestamp: timestampStr });

    try {
      await this.runPgDumpWithGzip(filepath);

      const validated = await this.validateBackupFile(filepath);
      if (!validated.valid) {
        throw new Error(validated.error);
      }

      const stats = statSync(filepath);
      const checksum = await this.generateChecksum(filepath);

      if (this.enableEncryption && this.encryptionKey) {
        await this.encryptFile(filepath);
      }

      const duration = Date.now() - startTime;
      logger.info('Backup completed successfully', {
        filename,
        size: stats.size,
        checksum,
        duration: `${duration}ms`,
      });

      return {
        success: true,
        filename: this.getS3Key(new Date(timestamp)),
        filepath,
        size: stats.size,
        checksum,
        duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Backup failed', { error: errorMessage, filename });
      return {
        success: false,
        filepath,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  private async runPgDumpWithGzip(outputPath: string): Promise<void> {
    const env = {
      ...process.env,
      PGPASSWORD: this.dbConfig.password,
    };

    const pgdumpArgs = [
      '-h',
      this.dbConfig.host,
      '-p',
      this.dbConfig.port.toString(),
      '-U',
      this.dbConfig.username,
      '-d',
      this.dbConfig.database,
      '-Fc',
    ];

    logger.debug('Executing pg_dump with gzip compression', {
      host: this.dbConfig.host,
      database: this.dbConfig.database,
    });

    const pgdump = spawn('pg_dump', pgdumpArgs, { env });
    const gzip = createGzip();
    const output = createWriteStream(outputPath);

    pgdump.stderr.on('data', (data) => {
      logger.debug('pg_dump stderr', { output: data.toString() });
    });

    await pipeline(pgdump.stdout, gzip, output);

    return new Promise((resolve, reject) => {
      pgdump.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump failed with code ${code}`));
        }
      });

      pgdump.on('error', (err) => {
        reject(new Error(`Failed to spawn pg_dump: ${err.message}`));
      });
    });
  }

  private async validateBackupFile(filepath: string): Promise<{ valid: boolean; error?: string }> {
    if (!existsSync(filepath)) {
      return { valid: false, error: 'Backup file does not exist' };
    }

    const stats = statSync(filepath);
    if (stats.size === 0) {
      return { valid: false, error: 'Backup file is empty' };
    }

    return { valid: true };
  }

  private async generateChecksum(filepath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filepath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async encryptFile(filepath: string): Promise<void> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key is required');
    }

    const encryptedPath = `${filepath}.enc`;
    const key = Buffer.from(this.encryptionKey.padEnd(32, '0').slice(0, 32), 'utf-8');
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const input = createReadStream(filepath);
    const output = createWriteStream(encryptedPath);

    await pipeline(input, cipher, output);

    unlinkSync(filepath);
    renameSync(encryptedPath, filepath);
    logger.info('Backup file encrypted', { filepath });
  }

  async cleanupTempFile(filepath: string): Promise<void> {
    try {
      if (existsSync(filepath)) {
        unlinkSync(filepath);
        logger.debug('Temp file cleaned up', { filepath });
      }
    } catch (error) {
      logger.warn('Failed to cleanup temp file', { filepath, error: String(error) });
    }
  }

  getS3Key(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');

    return `backups/${year}-${month}-${day}/backup-${year}${month}${day}T${hours}${minutes}${seconds}${ms}Z.sql.gz`;
  }
}
