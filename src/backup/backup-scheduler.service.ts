import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { loadConfig } from '../config';
import { BackupService } from './backup.service';

@Injectable()
export class BackupSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private schedule: string;

  constructor(private readonly backupService: BackupService) {
    const config = loadConfig();
    this.schedule = config.backup.schedule;
  }

  onModuleInit() {
    this.startScheduler();
  }

  private startScheduler() {
    this.logger.log(`Starting backup scheduler: ${this.schedule}`);
    
    cron.schedule(this.schedule, async () => {
      await this.backupService.runBackup();
    });
  }
}