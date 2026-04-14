import { Controller, Post, Get, OnModuleInit } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupSchedulerService } from './backup-scheduler.service';

@Controller('backup')
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    private readonly schedulerService: BackupSchedulerService,
  ) {}

  @Post('trigger')
  async triggerBackup() {
    return this.backupService.runBackup();
  }

  @Get('health')
  getHealth() {
    return this.backupService.getHealth();
  }
}