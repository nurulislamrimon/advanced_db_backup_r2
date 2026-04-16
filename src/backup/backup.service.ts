import { Injectable, Logger } from '@nestjs/common';
import { loadConfig, setLastBackupTime, getLastBackupTime } from '../config';
import { BackupService as OriginalBackupService } from '../services/backup';
import { R2Service } from '../r2/r2.service';
import { RetentionService } from '../retention/retention.service';
import { AlertService } from '../alert/alert.service';
import { BackupMetadata } from '../types';

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
}
