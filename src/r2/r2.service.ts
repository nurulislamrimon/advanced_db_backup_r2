import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream, statSync } from 'fs';
import { R2Config, BackupMetadata } from '../types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
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
    this.logger.log(`Uploading ${key}`);

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

        this.logger.log(`Upload successful: ${key} (${stats.size} bytes)`);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Upload attempt ${attempt} failed: ${errorMessage}`);

        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * attempt);
        } else {
          this.logger.error(`Upload failed after retries: ${key}`);
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
      this.logger.error('Failed to list backups', String(error));
      return [];
    }
  }

  async getObjectMetadata(key: string): Promise<BackupMetadata | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      const filename = key.split('/').pop() || '';
      const match = filename.match(
        /backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z\.sql\.gz/
      );

      let timestamp: Date;
      if (match) {
        const [, year, month, day, hour, min, sec, ms] = match;
        timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}Z`);
      } else {
        timestamp = new Date(response.LastModified || Date.now());
        this.logger.warn(
          `Could not parse timestamp from filename: ${filename}, using LastModified`
        );
      }

      return {
        timestamp: timestamp.toISOString(),
        filename,
        size: response.ContentLength || 0,
        checksum: response.ETag?.replace(/"/g, '') || '',
        duration: 0,
        status: 'success',
      };
    } catch (error) {
      this.logger.error(`Failed to get metadata for ${key}`, String(error));
      return null;
    }
  }

  async deleteBackups(keys: string[]): Promise<{ success: boolean; errors: string[] }> {
    if (keys.length === 0) {
      return { success: true, errors: [] };
    }

    this.logger.log(`Deleting ${keys.length} backups`);

    const errors: string[] = [];

    for (const key of keys) {
      try {
        const command = new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: [{ Key: key }] },
        });
        await this.client.send(command);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to delete ${key}`, errorMessage);
        errors.push(`${key}: ${errorMessage}`);
      }
    }

    return { success: errors.length === 0, errors };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
