import { Injectable, Logger } from '@nestjs/common';
import { AlertConfig, BackupMetadata } from '../types';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private config: AlertConfig | undefined;

  constructor(config: AlertConfig | undefined) {
    this.config = config;
  }

  async sendBackupSuccessAlert(metadata: BackupMetadata): Promise<void> {
    if (!this.config?.enabled) return;

    const message = `Backup completed successfully: ${metadata.filename} (${this.formatBytes(metadata.size)})`;
    await this.sendAlert(message, { ...metadata, alertType: 'success' });
  }

  async sendBackupFailureAlert(error: string, metadata?: Partial<BackupMetadata>): Promise<void> {
    if (!this.config?.enabled) return;

    const message = `Backup failed: ${error}`;
    await this.sendAlert(message, { ...metadata, error, alertType: 'failure' });
  }

  async sendUploadFailureAlert(error: string, filename: string): Promise<void> {
    if (!this.config?.enabled) return;

    const message = `Upload failed for ${filename}: ${error}`;
    await this.sendAlert(message, { filename, error, alertType: 'upload_failure' });
  }

  async sendRetentionFailureAlert(error: string): Promise<void> {
    if (!this.config?.enabled) return;

    const message = `Retention policy failed: ${error}`;
    await this.sendAlert(message, { error, alertType: 'retention_failure' });
  }

  private async sendAlert(message: string, details: Record<string, unknown>): Promise<void> {
    if (!this.config) return;

    this.logger.log(`Sending alert: ${message}`);

    try {
      if (this.config.type === 'webhook') {
        await this.sendWebhook(message, details);
      } else if (this.config.type === 'email') {
        await this.sendEmail(message, details);
      }
    } catch (error) {
      this.logger.error('Failed to send alert', String(error));
    }
  }

  private async sendWebhook(message: string, details: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.config!.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...details }),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
  }

  private async sendEmail(message: string, details: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.config!.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_email', message, ...details }),
    });

    if (!response.ok) {
      throw new Error(`Email API returned ${response.status}`);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}