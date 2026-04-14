import { R2Service } from './r2';
import { RetentionConfig, RetentionResult } from '../types';
import { logger } from '../utils/logger';

interface BackupInfo {
  key: string;
  date: Date;
  year: number;
  month: number;
  week: number;
  day: number;
}

export class RetentionService {
  private r2Service: R2Service;
  private config: RetentionConfig;

  constructor(r2Service: R2Service, config: RetentionConfig) {
    this.r2Service = r2Service;
    this.config = config;
  }

  async applyRetentionPolicy(dryRun = false): Promise<RetentionResult> {
    logger.info('Starting retention policy', { dryRun });

    const allBackups = await this.r2Service.listBackups('backups/');

    if (allBackups.length === 0) {
      logger.info('No backups found to process');
      return { deleted: [], kept: [], errors: [] };
    }

    const backupInfos = this.parseBackupDates(allBackups);
    const sortedBackups = backupInfos.sort((a, b) => b.date.getTime() - a.date.getTime());

    const { toKeep, toDelete } = this.determineRetention(sortedBackups);

    logger.info('Retention analysis', {
      total: sortedBackups.length,
      toKeep: toKeep.length,
      toDelete: toDelete.length,
    });

    if (dryRun) {
      logger.info('Dry-run mode: no files will be deleted');
      return {
        deleted: toDelete.map((b) => b.key),
        kept: toKeep.map((b) => b.key),
        errors: [],
      };
    }

    if (toDelete.length > 0) {
      const result = await this.r2Service.deleteBackups(toDelete.map((b) => b.key));
      return {
        deleted: toDelete.map((b) => b.key),
        kept: toKeep.map((b) => b.key),
        errors: result.errors,
      };
    }

    return { deleted: [], kept: toKeep.map((b) => b.key), errors: [] };
  }

  private parseBackupDates(keys: string[]): BackupInfo[] {
    const regex = /backups\/(\d{4})-(\d{2})-(\d{2})\/backup-(\d{8})T(\d{6})(\d{3})Z\.sql\.gz/;

    return keys
      .map((key) => {
        const match = key.match(regex);
        if (!match) {
          logger.warn('Could not parse backup key', { key });
          return null;
        }

        const [, year, month, day, _datePart, timePart, ms] = match;
        const dateStr = `${year}-${month}-${day}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}.${ms}Z`;
        const date = new Date(dateStr);

        if (isNaN(date.getTime())) {
          logger.warn('Invalid date in backup key', { key, dateStr });
          return null;
        }

        const week = this.getWeekNumber(date);

        return {
          key,
          date,
          year: parseInt(year),
          month: parseInt(month),
          week,
          day: parseInt(day),
        };
      })
      .filter((b): b is BackupInfo => b !== null);
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private determineRetention(sortedBackups: BackupInfo[]): {
    toKeep: BackupInfo[];
    toDelete: BackupInfo[];
  } {
    const toKeep: BackupInfo[] = [];
    const toDelete: BackupInfo[] = [];

    const keptDaily = new Set<string>();
    const keptWeekly = new Map<string, BackupInfo>();
    const keptMonthly = new Map<string, BackupInfo>();

    const mostRecent = sortedBackups[0];
    toKeep.push(mostRecent);

    for (let i = 1; i < sortedBackups.length; i++) {
      const backup = sortedBackups[i];
      const dateKey = `${backup.year}-${backup.month}-${backup.day}`;
      const weeklyKey = `${backup.year}-W${backup.week}`;
      const monthlyKey = `${backup.year}-${backup.month}`;

      if (keptDaily.size < this.config.daily && !keptDaily.has(dateKey)) {
        keptDaily.add(dateKey);
        toKeep.push(backup);
      } else if (!keptWeekly.has(weeklyKey) && keptWeekly.size < this.config.weekly) {
        keptWeekly.set(weeklyKey, backup);
        toKeep.push(backup);
      } else if (!keptMonthly.has(monthlyKey) && keptMonthly.size < this.config.monthly) {
        keptMonthly.set(monthlyKey, backup);
        toKeep.push(backup);
      } else {
        toDelete.push(backup);
      }
    }

    return { toKeep, toDelete };
  }
}
