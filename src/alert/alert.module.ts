import { Module, Global } from '@nestjs/common';
import { AlertService } from './alert.service';
import { AlertConfig } from '../types';

export { AlertService };
export { AlertConfig };

@Global()
@Module({
  providers: [
    {
      provide: AlertService,
      useFactory: () => {
        const config: AlertConfig | undefined = process.env.ALERT_ENABLED === 'true'
          ? {
              type: (process.env.ALERT_TYPE as 'email' | 'webhook') || 'webhook',
              url: process.env.ALERT_URL || '',
              enabled: true,
            }
          : undefined;
        return new AlertService(config);
      },
    },
  ],
  exports: [AlertService],
})
export class AlertModule {}