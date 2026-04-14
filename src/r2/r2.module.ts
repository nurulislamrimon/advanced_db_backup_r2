import { Module, Global } from '@nestjs/common';
import { R2Service } from './r2.service';
import { R2Config } from '../types';

export { R2Service };
export { R2Config };

@Global()
@Module({
  providers: [
    {
      provide: R2Service,
      useFactory: () => {
        const config: R2Config = {
          endpoint: process.env.R2_ENDPOINT || '',
          accessKey: process.env.R2_ACCESS_KEY || '',
          secretKey: process.env.R2_SECRET_KEY || '',
          bucket: process.env.R2_BUCKET || '',
        };
        return new R2Service(config);
      },
    },
  ],
  exports: [R2Service],
})
export class R2Module {}