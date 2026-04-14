import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { loadConfig } from '../config';
import { BackupService } from './backup.service';
import { BackupQueueService } from './backup-queue.service';

@Injectable()
export class BackupSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private schedule: string;
  private queueService!: BackupQueueService;

  constructor(private readonly backupService: BackupService) {
    const config = loadConfig();
    this.schedule = config.backup.schedule;
  }

  async onModuleInit() {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

    this.queueService = new BackupQueueService(redisHost, redisPort, () =>
      this.backupService.runBackup()
    );

    await this.queueService.addCronJob(this.schedule);
    this.logger.log(`Backup scheduler started with schedule: ${this.schedule}`);
  }

  async onModuleDestroy() {
    if (this.queueService) {
      await this.queueService.close();
    }
  }

  async getQueueHealth() {
    if (!this.queueService) {
      return { status: 'not_initialized' };
    }
    const counts = await this.queueService.getJobCounts();
    return {
      status: 'ok',
      queue: 'backup-queue',
      jobs: counts,
    };
  }
}
