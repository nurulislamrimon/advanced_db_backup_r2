import { Module, Global } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionConfig, R2Config } from '../types';
import { R2Service } from '../r2/r2.service';

export { RetentionService };
export { RetentionConfig };

@Global()
@Module({
  providers: [
    {
      provide: RetentionService,
      useFactory: () => {
        const config: RetentionConfig = {
          daily: parseInt(process.env.RETENTION_DAILY || '7'),
          weekly: parseInt(process.env.RETENTION_WEEKLY || '4'),
          monthly: parseInt(process.env.RETENTION_MONTHLY || '12'),
        };
        const r2Config: R2Config = {
          endpoint: process.env.R2_ENDPOINT || '',
          accessKey: process.env.R2_ACCESS_KEY || '',
          secretKey: process.env.R2_SECRET_KEY || '',
          bucket: process.env.R2_BUCKET || '',
        };
        const r2Service = new R2Service(r2Config);
        return new RetentionService(r2Service, config);
      },
    },
  ],
  exports: [RetentionService],
})
export class RetentionModule {}
