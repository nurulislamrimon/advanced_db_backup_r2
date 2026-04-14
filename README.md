# Database Backup Worker

Production-grade PostgreSQL backup worker that runs in Docker and uploads backups to Cloudflare R2.

## Features

- Automated daily backups via cron scheduling
- PostgreSQL database dump using pg_dump
- Gzip compression for efficient storage
- SHA256 checksum verification
- Cloudflare R2 S3-compatible upload with streaming
- Intelligent retention policy (daily/weekly/monthly)
- Optional AES-256 encryption
- Alerting via webhook or email
- Structured JSON logging
- Graceful error handling with retries

## Quick Start

### 1. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 2. Start with Docker Compose

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f backup-worker

# Stop
docker-compose down
```

## Configuration

### PostgreSQL Connection

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | Database host | `postgres` |
| `POSTGRES_PORT` | Database port | `5432` |
| `POSTGRES_USER` | Database username | - |
| `POSTGRES_PASSWORD` | Database password | - |
| `POSTGRES_DB` | Database name | - |

### Cloudflare R2

| Variable | Description | Required |
|----------|-------------|----------|
| `R2_ENDPOINT` | R2 endpoint URL | Yes |
| `R2_ACCESS_KEY` | R2 access key | Yes |
| `R2_SECRET_KEY` | R2 secret key | Yes |
| `R2_BUCKET` | R2 bucket name | Yes |

### Backup Schedule

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Cron expression | `0 2 * * *` |

### Retention Policy

| Variable | Description | Default |
|----------|-------------|---------|
| `RETENTION_DAILY` | Daily backups to keep | `7` |
| `RETENTION_WEEKLY` | Weekly backups to keep | `4` |
| `RETENTION_MONTHLY` | Monthly backups to keep | `6` |

### Optional: Encryption

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | 32-character key for AES-256 |

### Optional: Alerting

| Variable | Description |
|----------|-------------|
| `ALERT_TYPE` | `webhook` or `email` |
| `ALERT_WEBHOOK` | Webhook URL |
| `ALERT_EMAIL` | Email API URL |

## Usage

### Manual Backup Trigger

```bash
docker-compose exec backup-worker node dist/index.js --trigger
```

### Dry-Run Retention

```bash
docker-compose exec backup-worker node dist/index.js --dry-run
```

### Health Check

```bash
# Check last backup time
docker-compose exec backup-worker cat /tmp/last_backup_timestamp
```

## File Structure

```
db-backup-worker/
├── src/
│   ├── config/         # Configuration loader
│   ├── services/      # Backup, R2, Retention, Alert services
│   ├── types/         # TypeScript interfaces
│   ├── utils/         # Logger utility
│   └── index.ts       # Main entry point
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## Backup File Naming

Format: `backups/YYYY-MM-DD/backup-<timestamp>.sql.gz`

Example: `backups/2024-01-15/backup-20240115T020000Z.sql.gz`

## Retention Logic

1. Keep the most recent backup (never deleted)
2. Keep last N daily backups (one per day)
3. Keep last N weekly backups (one per week)
4. Keep last N monthly backups (one per month)
5. Delete all others

## Build from Source

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run locally (requires PostgreSQL and R2)
npm start
```

## Security Notes

- Never commit `.env` file to version control
- Use Docker secrets for production credentials
- Rotate R2 access keys regularly
- Enable encryption for sensitive databases