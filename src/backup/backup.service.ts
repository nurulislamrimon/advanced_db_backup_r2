import { Injectable, Logger } from '@nestjs/common';
import { loadConfig, setLastBackupTime, getLastBackupTime } from '../config';
import { BackupService as OriginalBackupService } from '../services/backup';
import { R2Service } from '../r2/r2.service';
import { RetentionService } from '../retention/retention.service';
import { AlertService } from '../alert/alert.service';
import { BackupMetadata } from '../types';
import { RestoreDto } from './dto/restore.dto';
import { existsSync, unlinkSync, createWriteStream } from 'fs';
import { spawn } from 'child_process';

export interface RestoreResult {
  success: boolean;
  message: string;
  error?: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private originalService: OriginalBackupService;
  private r2Service: R2Service;
  private retentionService: RetentionService;
  private alertService: AlertService;
  private isRunning = false;

  constructor() {
    const config = loadConfig();
    this.originalService = new OriginalBackupService(
      config.db,
      config.backup.tempDir,
      config.backup.enableEncryption,
      config.backup.encryptionKey
    );
    this.r2Service = new R2Service(config.r2);
    this.retentionService = new RetentionService(this.r2Service, config.backup.retention);
    this.alertService = new AlertService(config.alert);
  }

  async runBackup(): Promise<BackupMetadata> {
    if (this.isRunning) {
      this.logger.warn('Backup already in progress, skipping');
      return {
        timestamp: new Date().toISOString(),
        filename: '',
        size: 0,
        checksum: '',
        duration: 0,
        status: 'failure',
        error: 'Backup already in progress',
      };
    }

    this.isRunning = true;
    this.logger.log('Starting backup');

    try {
      const result = await this.originalService.executeBackup();

      if (!result.success) {
        const metadata: BackupMetadata = {
          timestamp: new Date().toISOString(),
          filename: '',
          size: 0,
          checksum: '',
          duration: result.duration || 0,
          status: 'failure',
          error: result.error,
        };
        await this.alertService.sendBackupFailureAlert(result.error || 'Unknown error', {
          duration: result.duration,
        });
        this.isRunning = false;
        return metadata;
      }

      if (result.filepath && result.filename) {
        const uploadResult = await this.r2Service.uploadFile(result.filepath, result.filename);

        if (!uploadResult.success) {
          const metadata: BackupMetadata = {
            timestamp: new Date().toISOString(),
            filename: result.filename || '',
            size: result.size || 0,
            checksum: result.checksum || '',
            duration: result.duration || 0,
            status: 'failure',
            error: `Upload failed: ${uploadResult.error}`,
          };
          await this.alertService.sendUploadFailureAlert(
            uploadResult.error || 'Unknown error',
            result.filename
          );
          this.isRunning = false;
          return metadata;
        }

        await this.originalService.cleanupTempFile(result.filepath);
      }

      const metadata: BackupMetadata = {
        timestamp: new Date().toISOString(),
        filename: result.filename || '',
        size: result.size || 0,
        checksum: result.checksum || '',
        duration: result.duration || 0,
        status: 'success',
      };

      setLastBackupTime(Date.now());
      await this.alertService.sendBackupSuccessAlert(metadata);

      await this.runRetention();
      return metadata;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Backup error', errorMessage);
      await this.alertService.sendBackupFailureAlert(errorMessage);
      return {
        timestamp: new Date().toISOString(),
        filename: '',
        size: 0,
        checksum: '',
        duration: 0,
        status: 'failure',
        error: errorMessage,
      };
    } finally {
      this.isRunning = false;
    }
  }

  async getAllBackups(): Promise<BackupMetadata[]> {
    const keys = await this.r2Service.listBackups('backups/');
    const backups: BackupMetadata[] = [];

    for (const key of keys) {
      const metadata = await this.r2Service.getObjectMetadata(key);
      if (metadata) {
        backups.push(metadata);
      }
    }

    return backups.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async runRetention(dryRun = false): Promise<void> {
    try {
      const result = await this.retentionService.applyRetentionPolicy(dryRun);
      this.logger.log(
        `Retention completed: deleted=${result.deleted.length}, kept=${result.kept.length}`
      );

      if (result.errors.length > 0) {
        await this.alertService.sendRetentionFailureAlert(result.errors.join(', '));
      }
    } catch (error) {
      this.logger.error('Retention failed', String(error));
    }
  }

  getHealth(): { lastBackup: number | null; isRunning: boolean } {
    return {
      lastBackup: getLastBackupTime(),
      isRunning: this.isRunning,
    };
  }

  async restoreBackup(dto: RestoreDto): Promise<RestoreResult> {
    const config = loadConfig();
    const tempDir = config.backup.tempDir;
    const localPath = `${tempDir}/restore-${dto.filename}`;

    try {
      const allKeys = await this.r2Service.listBackups('backups/');
      const matchingKey = allKeys.find((k) => k.endsWith(dto.filename));

      if (!matchingKey) {
        return {
          success: false,
          message: 'Backup file not found',
          error: `No file matching "${dto.filename}"`,
        };
      }

      const downloadResult = await this.r2Service.downloadFile(matchingKey, localPath);

      if (!downloadResult.success) {
        return { success: false, message: 'Download failed', error: downloadResult.error };
      }

      const targetHost = dto.host || config.db.host;
      const targetPort = dto.port || config.db.port;
      const targetUser = dto.username || config.db.username;
      const targetPass = dto.password || config.db.password;
      const targetDb = dto.database || config.db.database;

      this.logger.log(`Restoring to ${targetHost}:${targetPort}/${targetDb} as ${targetUser}`);

      if (dto.dropExisting) {
        this.logger.log(`Dropping existing database: ${targetDb}`);
        const dropResult = await this.dropDatabase(
          targetHost,
          targetPort,
          targetUser,
          targetPass,
          targetDb
        );
        if (!dropResult.success) {
          return { success: false, message: 'Drop database failed', error: dropResult.error };
        }

        this.logger.log(`Creating database: ${targetDb}`);
        const createResult = await this.createDatabase(
          targetHost,
          targetPort,
          targetUser,
          targetPass,
          targetDb
        );
        if (!createResult.success) {
          return { success: false, message: 'Create database failed', error: createResult.error };
        }
      }

      const restoreResult = await this.restorePgDump(
        localPath,
        targetHost,
        targetPort,
        targetUser,
        targetPass,
        targetDb
      );

      return restoreResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Restore failed', error: errorMessage };
    } finally {
      if (existsSync(localPath)) {
        unlinkSync(localPath);
      }
    }
  }

  private async dropDatabase(
    host: string,
    port: number,
    username: string,
    password: string,
    database: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const env = { ...process.env, PGPASSWORD: password };
      const psql = spawn(
        'psql',
        [
          '-h',
          host,
          '-p',
          port.toString(),
          '-U',
          username,
          '-d',
          'postgres',
          '-c',
          `DROP DATABASE IF EXISTS "${database}"`,
        ],
        { env }
      );

      let stderr = '';
      psql.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      psql.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr });
        }
      });

      psql.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  private async createDatabase(
    host: string,
    port: number,
    username: string,
    password: string,
    database: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const env = { ...process.env, PGPASSWORD: password };
      const psql = spawn(
        'psql',
        [
          '-h',
          host,
          '-p',
          port.toString(),
          '-U',
          username,
          '-d',
          'postgres',
          '-c',
          `CREATE DATABASE "${database}"`,
        ],
        { env }
      );

      let stderr = '';
      let stdout = '';
      psql.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      psql.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      psql.on('close', (code) => {
        if (code === 0) {
          this.logger.log(`Database created: ${database}`);
          resolve({ success: true });
        } else {
          this.logger.error(`Create database failed: ${stdout} ${stderr}`);
          resolve({ success: false, error: stdout + '\n' + stderr });
        }
      });

      psql.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  private async restorePgDump(
    filepath: string,
    host: string,
    port: number,
    username: string,
    password: string,
    database: string
  ): Promise<RestoreResult> {
    return new Promise((resolve) => {
      const env = { ...process.env, PGPASSWORD: password };
      const decompressedPath = filepath.replace('.gz', '');

      const gunzip = spawn('gunzip', ['-c', '-d', filepath]);
      const output = createWriteStream(decompressedPath);

      gunzip.stdout.pipe(output);

      gunzip.on('close', (code) => {
        output.end(() => {
          if (code !== 0) {
            resolve({ success: false, message: `Gunzip failed (code ${code})` });
            return;
          }

          const pgRestore = spawn(
            'pg_restore',
            [
              '--clean',
              '--if-exists',
              '--no-security-labels',
              '--no-table-access-method',
              '--no-tablespaces',
              '--no-owner',
              '--no-privileges',
              '-h',
              host,
              '-p',
              port.toString(),
              '-U',
              username,
              '-d',
              database,
              '-v',
              decompressedPath,
            ],
            { env }
          );

          let pgRestoreStdout = '';
          let pgRestoreStderr = '';
          pgRestore.stdout.on('data', (data) => {
            pgRestoreStdout += data.toString();
          });
          pgRestore.stderr.on('data', (data) => {
            pgRestoreStderr += data.toString();
          });

          pgRestore.on('close', (restoreCode) => {
            if (existsSync(decompressedPath)) unlinkSync(decompressedPath);

            const output = pgRestoreStdout + pgRestoreStderr;
            const lines = output
              .split('\n')
              .filter((line) => !line.toLowerCase().includes('transaction_timeout'));
            const filteredOutput = lines.join('\n');

            if (restoreCode === 0) {
              this.logger.log('Restore completed successfully');
              resolve({ success: true, message: 'Restore completed successfully' });
            } else if (
              restoreCode === 1 &&
              (filteredOutput.includes('warning') || filteredOutput.includes('errors ignored'))
            ) {
              this.logger.warn(`pg_restore completed with warnings`);
              resolve({
                success: true,
                message: 'Restore completed (with warnings)',
                error: filteredOutput,
              });
            } else {
              this.logger.error(`pg_restore failed: ${output}`);
              resolve({
                success: false,
                message: `pg_restore failed (code ${restoreCode})`,
                error: output,
              });
            }
          });

          pgRestore.on('error', (err) => {
            if (existsSync(decompressedPath)) unlinkSync(decompressedPath);
            this.logger.error(`pg_restore error: ${err.message}`);
            resolve({ success: false, message: 'pg_restore failed', error: err.message });
          });
        });
      });

      gunzip.on('error', (err) => {
        resolve({ success: false, message: 'Gunzip failed', error: err.message });
      });
    });
  }
}
