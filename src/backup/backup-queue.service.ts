import { Worker, Queue, QueueEvents } from 'bullmq';
import { Logger } from '@nestjs/common';

export class BackupQueueService {
  private readonly logger = new Logger(BackupQueueService.name);
  private queue: Queue;
  private worker: Worker;
  private queueEvents: QueueEvents;

  constructor(
    private redisHost: string,
    private redisPort: number,
    private backupJob: () => Promise<void>
  ) {
    this.queue = new Queue('backup-queue', {
      connection: {
        host: this.redisHost,
        port: this.redisPort,
      },
    });

    this.queueEvents = new QueueEvents('backup-queue', {
      connection: {
        host: this.redisHost,
        port: this.redisPort,
      },
    });

    this.worker = new Worker(
      'backup-queue',
      async () => {
        this.logger.log('Processing backup job');
        await this.backupJob();
      },
      {
        connection: {
          host: this.redisHost,
          port: this.redisPort,
        },
        concurrency: 1,
      }
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Backup job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Backup job ${job?.id} failed: ${err.message}`);
    });
  }

  async addCronJob(cronExpression: string): Promise<void> {
    await this.queue.add(
      'scheduled-backup',
      {},
      {
        repeat: {
          pattern: cronExpression,
        },
      }
    );

    this.logger.log(`Scheduled backup job with cron: ${cronExpression}`);
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.queueEvents.close();
  }

  async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
    };
  }

  async pause(): Promise<void> {
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    await this.queue.resume();
  }
}
