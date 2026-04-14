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

  async runBackup(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Backup already in progress, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting backup');

    try {
      const result = await this.originalService.executeBackup();

      if (!result.success) {
        await this.alertService.sendBackupFailureAlert(result.error || 'Unknown error', {
          duration: result.duration,
        });
        this.isRunning = false;
        return;
      }

      if (result.filepath && result.filename) {
        const uploadResult = await this.r2Service.uploadFile(result.filepath, result.filename);

        if (!uploadResult.success) {
          await this.alertService.sendUploadFailureAlert(uploadResult.error || 'Unknown error', result.filename);
          this.isRunning = false;
          return;
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Backup error', errorMessage);
      await this.alertService.sendBackupFailureAlert(errorMessage);
    } finally {
      this.isRunning = false;
    }
  }

  async runRetention(dryRun = false): Promise<void> {
    try {
      const result = await this.retentionService.applyRetentionPolicy(dryRun);
      this.logger.log(`Retention completed: deleted=${result.deleted.length}, kept=${result.kept.length}`);

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