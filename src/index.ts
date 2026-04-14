import * as cron from 'node-cron';
import { loadConfig, setLastBackupTime, getLastBackupTime } from './config';
import { logger } from './utils/logger';
import { BackupService } from './services/backup';
import { R2Service } from './services/r2';
import { RetentionService } from './services/retention';
import { AlertService } from './services/alert';
import { BackupMetadata } from './types';

class BackupWorker {
  private backupService: BackupService;
  private r2Service: R2Service;
  private retentionService: RetentionService;
  private alertService: AlertService;
  private schedule: string;
  private isRunning = false;

  constructor() {
    const config = loadConfig();

    this.backupService = new BackupService(
      config.db,
      config.backup.tempDir,
      config.backup.enableEncryption,
      config.backup.encryptionKey
    );

    this.r2Service = new R2Service(config.r2);
    this.retentionService = new RetentionService(this.r2Service, config.backup.retention);
    this.alertService = new AlertService(config.alert);
    this.schedule = config.backup.schedule;
  }

  async start(): Promise<void> {
    logger.info('Starting backup worker', { schedule: this.schedule });

    cron.schedule(this.schedule, async () => {
      await this.runBackup();
    });

    await this.runBackup();
  }

  async runBackup(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Backup already in progress, skipping');
      return;
    }

    this.isRunning = true;
    logger.info('Starting scheduled backup');

    try {
      const result = await this.backupService.executeBackup();

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

        await this.backupService.cleanupTempFile(result.filepath);
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
      logger.error('Backup worker error', { error: errorMessage });
      await this.alertService.sendBackupFailureAlert(errorMessage);
    } finally {
      this.isRunning = false;
    }
  }

  async runRetention(dryRun = false): Promise<void> {
    try {
      const result = await this.retentionService.applyRetentionPolicy(dryRun);
      logger.info('Retention policy completed', {
        deleted: result.deleted.length,
        kept: result.kept.length,
        errors: result.errors.length,
        dryRun,
      });

      if (result.errors.length > 0) {
        await this.alertService.sendRetentionFailureAlert(result.errors.join(', '));
      }
    } catch (error) {
      logger.error('Retention policy failed', { error: String(error) });
    }
  }

  getHealth(): { lastBackup: number | null; isRunning: boolean; schedule: string } {
    return {
      lastBackup: getLastBackupTime(),
      isRunning: this.isRunning,
      schedule: this.schedule,
    };
  }

  async triggerManualBackup(): Promise<void> {
    logger.info('Manual backup triggered');
    await this.runBackup();
  }
}

let worker: BackupWorker;

async function main(): Promise<void> {
  logger.info('DB Backup Worker starting...');

  if (process.argv.includes('--dry-run')) {
    logger.info('Running retention in dry-run mode');
    const config = loadConfig();
    const r2Service = new R2Service(config.r2);
    const retentionService = new RetentionService(r2Service, config.backup.retention);
    const result = await retentionService.applyRetentionPolicy(true);
    logger.info('Dry-run result', { ...result });
    return;
  }

  worker = new BackupWorker();

  if (process.argv.includes('--trigger')) {
    await worker.triggerManualBackup();
  } else {
    await worker.start();
  }
}

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

main().catch((error) => {
  logger.error('Fatal error', { error: String(error) });
  process.exit(1);
});