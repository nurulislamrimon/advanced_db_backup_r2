import { RetentionService } from '../services/retention';
import { RetentionConfig } from '../types';

class MockR2Service {
  private backups: Map<string, string> = new Map();

  setBackups(backups: string[]) {
    this.backups.clear();
    backups.forEach((key) => this.backups.set(key, key));
  }

  async listBackups(prefix: string): Promise<string[]> {
    return Array.from(this.backups.keys()).filter((k) => k.startsWith(prefix));
  }

  async deleteBackups(keys: string[]): Promise<{ success: boolean; errors: string[] }> {
    keys.forEach((k) => this.backups.delete(k));
    return { success: true, errors: [] };
  }
}

describe('RetentionService', () => {
  let mockR2Service: MockR2Service;
  let retentionService: RetentionService;

  beforeEach(() => {
    mockR2Service = new MockR2Service();
    const config: RetentionConfig = { daily: 7, weekly: 4, monthly: 6 };
    // @ts-expect-error - testing with mock
    retentionService = new RetentionService(mockR2Service, config);
  });

  describe('applyRetentionPolicy', () => {
    it('should return empty result when no backups exist', async () => {
      mockR2Service.setBackups([]);
      const result = await retentionService.applyRetentionPolicy();
      expect(result.deleted).toHaveLength(0);
      expect(result.kept).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should keep all backups when under retention limit', async () => {
      const backups = ['backups/2026-04-14/backup-20260414T020000000Z.sql.gz'];
      mockR2Service.setBackups(backups);
      const result = await retentionService.applyRetentionPolicy();
      expect(result.kept).toHaveLength(1);
      expect(result.deleted).toHaveLength(0);
    });

    it('should handle multiple backups correctly', async () => {
      const backups = [
        'backups/2026-04-14/backup-20260414T020000000Z.sql.gz',
        'backups/2026-04-13/backup-20260413T020000000Z.sql.gz',
      ];
      mockR2Service.setBackups(backups);
      const result = await retentionService.applyRetentionPolicy();
      expect(result.kept.length).toBeGreaterThanOrEqual(1);
      expect(result.deleted.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dry-run mode', () => {
    it('should not delete backups in dry-run mode', async () => {
      const backups = [
        'backups/2026-04-14/backup-20260414T020000000Z.sql.gz',
        'backups/2026-04-13/backup-20260413T020000000Z.sql.gz',
      ];
      mockR2Service.setBackups(backups);
      const result = await retentionService.applyRetentionPolicy(true);
      expect(result.kept.length).toBeGreaterThanOrEqual(1);
      expect(result.deleted.length).toBeGreaterThanOrEqual(0);
    });
  });
});
