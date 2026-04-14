import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { R2Module } from '../r2/r2.module';
import { RetentionModule } from '../retention/retention.module';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [R2Module, RetentionModule, AlertModule],
  controllers: [BackupController],
  providers: [BackupService, BackupSchedulerService],
  exports: [BackupService],
})
export class BackupModule {}