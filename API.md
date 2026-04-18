# Database Backup Worker - API Documentation

Production-grade PostgreSQL backup worker with Cloudflare R2 storage.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        backup-worker                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Backup     │  │   R2         │  │   Alert      │             │
│  │   Service    │──│   Service    │──│   Service    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│         │                 │                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Backup     │  │   Retention  │  │   Scheduler  │             │
│  │   Controller │  │   Service    │  │   Service    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
           │                     │                    │
           ▼                     ▼                    ▼
    ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
    │ PostgreSQL  │      │  Cloudflare │      │    Redis    │
    │   Database  │      │     R2      │      │    Queue    │
    └─────────────┘      └─────────────┘      └─────────────┘
```

## REST API Endpoints

### Health Checks

| Method | Endpoint               | Description                                  |
| ------ | ---------------------- | -------------------------------------------- |
| GET    | `/health`              | Application health check                     |
| GET    | `/backup/health`       | Backup status (last backup time, is running) |
| GET    | `/backup/queue/health` | Queue health status                          |

### Backup Operations

| Method | Endpoint          | Description                  |
| ------ | ----------------- | ---------------------------- |
| POST   | `/backup/trigger` | Manually trigger a backup    |
| GET    | `/backup/files`   | List all backup files in R2  |
| POST   | `/backup/restore` | Restore database from backup |

### Restore Endpoint Details

**POST** `/backup/restore`

Request Body:

```json
{
  "filename": "backup-20240415T020000Z.sql.gz",
  "host": "optional-db-host",
  "port": 5432,
  "username": "optional-user",
  "password": "optional-pass",
  "database": "optional-db-name",
  "dropExisting": true
}
```

Response:

```json
{
  "success": true,
  "message": "Restore completed successfully",
  "error": "optional error details"
}
```

## Features

### Automated Backups

- Scheduled via cron (default: 2:00 AM daily)
- PostgreSQL dump using `pg_dump` with custom format (`-Fc`)
- Gzip compression
- SHA256 checksum verification

### R2 Storage

- S3-compatible API integration
- Streaming upload (no local temp storage for large files)
- Automatic retry (3 attempts with exponential backoff)

### Retention Policy

- **Daily**: Keep last N daily backups (default: 7)
- **Weekly**: Keep last N weekly backups (default: 4)
- **Monthly**: Keep last N monthly backups (default: 6)
- Never deletes the most recent backup

### Restore Functionality

- Download backup from R2
- Decompress gzip archive
- Drop existing database (optional)
- Create new database
- Restore with `--clean --if-exists` to handle existing constraints

### Alerting

- Webhook or email notifications
- Alerts on: backup success, backup failure, upload failure, retention errors

### Encryption (Optional)

- AES-256-CBC encryption
- 32-character key required

## Configuration

### Environment Variables

| Variable            | Required | Default     | Description             |
| ------------------- | -------- | ----------- | ----------------------- |
| `POSTGRES_HOST`     | Yes      | -           | Database host           |
| `POSTGRES_PORT`     | Yes      | 5432        | Database port           |
| `POSTGRES_USER`     | Yes      | -           | Database username       |
| `POSTGRES_PASSWORD` | Yes      | -           | Database password       |
| `POSTGRES_DB`       | Yes      | -           | Database name           |
| `R2_ENDPOINT`       | Yes      | -           | R2 endpoint URL         |
| `R2_ACCESS_KEY`     | Yes      | -           | R2 access key           |
| `R2_SECRET_KEY`     | Yes      | -           | R2 secret key           |
| `R2_BUCKET`         | Yes      | -           | R2 bucket name          |
| `BACKUP_SCHEDULE`   | No       | `0 2 * * *` | Cron schedule           |
| `RETENTION_DAILY`   | No       | 7           | Daily retention count   |
| `RETENTION_WEEKLY`  | No       | 4           | Weekly retention count  |
| `RETENTION_MONTHLY` | No       | 6           | Monthly retention count |
| `ENABLE_ENCRYPTION` | No       | false       | Enable encryption       |
| `ENCRYPTION_KEY`    | No       | -           | 32-char encryption key  |
| `ALERT_TYPE`        | No       | -           | `webhook` or `email`    |
| `ALERT_WEBHOOK`     | No       | -           | Webhook URL             |
| `ALERT_EMAIL`       | No       | -           | Email API URL           |
| `TEMP_DIR`          | No       | `/tmp`      | Temp directory          |
| `REDIS_HOST`        | No       | localhost   | Redis host              |
| `REDIS_PORT`        | No       | 6379        | Redis port              |

## File Structure

```
src/
├── main.ts                    # Application entry point
├── app.module.ts              # Root module
├── config/
│   └── index.ts               # Configuration loader
├── types/
│   └── index.ts               # TypeScript interfaces
├── utils/
│   └── logger.ts              # Logger utility
├── services/
│   ├── backup.ts             # Core backup logic
│   ├── r2.ts                 # R2 client wrapper
│   ├── retention.ts          # Retention policy logic
│   └── alert.ts              # Alert service
├── backup/
│   ├── backup.module.ts      # Backup module
│   ├── backup.service.ts    # Backup service (orchestration)
│   ├── backup.controller.ts # REST API controller
│   ├── backup-scheduler.service.ts  # Cron scheduler
│   ├── backup-queue.service.ts     # Queue processing
│   └── dto/
│       └── restore.dto.ts    # Restore DTO
├── r2/
│   ├── r2.module.ts         # R2 module
│   └── r2.service.ts         # R2 service (NestJS wrapper)
├── retention/
│   ├── retention.module.ts  # Retention module
│   └── retention.service.ts # Retention service (NestJS wrapper)
└── alert/
    ├── alert.module.ts      # Alert module
    └── alert.service.ts     # Alert service (NestJS wrapper)
```

## Backup File Naming

Format: `backups/YYYY-MM-DD/backup-<timestamp>.sql.gz`

Example: `backups/2024-04-15/backup-20240415T020000Z.sql.gz`

## CLI Usage

```bash
# Build
npm run build

# Run
npm start

# Development
npm run dev
```

## Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f backup-worker

# Stop
docker-compose down
```

## API Response Examples

### Health Check

```json
{
  "status": "ok",
  "timestamp": "2024-04-15T02:30:00.000Z"
}
```

### Backup Health

```json
{
  "lastBackup": 1713151200000,
  "isRunning": false
}
```

### List Backups

```json
[
  {
    "timestamp": "2024-04-15T02:00:00.000Z",
    "filename": "backup-20240415T020000Z.sql.gz",
    "size": 15728640,
    "checksum": "abc123...",
    "duration": 45000,
    "status": "success"
  }
]
```

### Trigger Backup

```json
{
  "timestamp": "2024-04-15T02:30:00.000Z",
  "filename": "backups/2024-04-15/backup-20240415T023000Z.sql.gz",
  "size": 15728640,
  "checksum": "abc123...",
  "duration": 45000,
  "status": "success"
}
```
