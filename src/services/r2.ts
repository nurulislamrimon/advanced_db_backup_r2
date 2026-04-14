import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createReadStream, statSync } from 'fs';
import { R2Config } from '../types';
import { logger } from '../utils/logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class R2Service {
  private client: S3Client;
  private bucket: string;

  constructor(config: R2Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
  }

  async uploadFile(filepath: string, key: string): Promise<{ success: boolean; error?: string }> {
    logger.info('Starting R2 upload', { key, filepath });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const stats = statSync(filepath);
        const fileStream = createReadStream(filepath);

        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: fileStream,
          ContentType: 'application/gzip',
          ContentLength: stats.size,
        });

        await this.client.send(command);

        logger.info('R2 upload successful', { key, size: stats.size, attempt });
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`R2 upload attempt ${attempt} failed`, { error: errorMessage, key });

        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * attempt);
        } else {
          logger.error('R2 upload failed after all retries', { key, error: errorMessage });
          return { success: false, error: errorMessage };
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  async listBackups(prefix = 'backups/'): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });

      const response = await this.client.send(command);
      return response.Contents?.map((obj) => obj.Key || '') || [];
    } catch (error) {
      logger.error('Failed to list R2 backups', { error: String(error) });
      return [];
    }
  }

  async deleteBackups(keys: string[]): Promise<{ success: boolean; errors: string[] }> {
    if (keys.length === 0) {
      return { success: true, errors: [] };
    }

    logger.info('Deleting backups from R2', { count: keys.length });

    const errors: string[] = [];

    for (const key of keys) {
      try {
        const command = new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: [{ Key: key }],
          },
        });
        await this.client.send(command);
        logger.debug('Deleted backup', { key });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to delete backup', { key, error: errorMessage });
        errors.push(`${key}: ${errorMessage}`);
      }
    }

    return { success: errors.length === 0, errors };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}