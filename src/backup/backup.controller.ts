import { Controller, Post, Get } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupSchedulerService } from './backup-scheduler.service';

@Controller()
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    private readonly schedulerService: BackupSchedulerService
  ) {}

  @Get('health')
  getAppHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('backup/health')
  getBackupHealth() {
    return this.backupService.getHealth();
  }

  @Post('backup/trigger')
  async triggerBackup() {
    return this.backupService.runBackup();
  }
}
