export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface R2Config {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export interface BackupConfig {
  schedule: string;
  retention: RetentionConfig;
  tempDir: string;
  enableEncryption: boolean;
  encryptionKey?: string;
}

export interface RetentionConfig {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface BackupMetadata {
  timestamp: string;
  filename: string;
  size: number;
  checksum: string;
  duration: number;
  status: 'success' | 'failure';
  error?: string;
}

export interface AppConfig {
  db: DatabaseConfig;
  r2: R2Config;
  backup: BackupConfig;
  alert?: AlertConfig;
}

export interface AlertConfig {
  type: 'email' | 'webhook';
  url: string;
  enabled: boolean;
}

export interface BackupResult {
  success: boolean;
  filename?: string;
  filepath?: string;
  size?: number;
  checksum?: string;
  duration?: number;
  error?: string;
}

export interface RetentionResult {
  deleted: string[];
  kept: string[];
  errors: string[];
}