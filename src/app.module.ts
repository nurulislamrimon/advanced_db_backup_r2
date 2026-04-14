import { Module } from '@nestjs/common';
import { BackupModule } from './backup/backup.module';

@Module({
  imports: [BackupModule],
})
export class AppModule {}