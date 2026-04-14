import { Module, Global } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionConfig } from '../types';

export { RetentionService };
export { RetentionConfig };

@Global()
@Module({
  providers: [
    {
      provide: RetentionService,
      useFactory: (r2Service: any) => {
        const config: RetentionConfig = {
          daily: parseInt(process.env.RETENTION_DAILY || '7'),
          weekly: parseInt(process.env.RETENTION_WEEKLY || '4'),
          monthly: parseInt(process.env.RETENTION_MONTHLY || '12'),
        };
        return new RetentionService(r2Service, config);
      },
      inject: [require('../r2/r2.service').R2Service],
    },
  ],
  exports: [RetentionService],
})
export class RetentionModule {}