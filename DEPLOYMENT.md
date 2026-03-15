# NanoClaw Deployment Guide

## 1. Environment Requirements

- OS: macOS or Linux
- Node.js: 20+
- Docker Engine/Desktop: 26+
- Docker Compose: v2.27+

## 2. Configure Environment

1. Copy template:

```bash
cp .env.example .env
```

2. Edit `.env` and set:
   - `AUTH_SECRET`
   - `ADMIN_PASSWORD`
   - `ANTHROPIC_AUTH_TOKEN`
   - optional `ANTHROPIC_BASE_URL`, `MODEL_NAME`

## 3. Deploy

```bash
docker compose up -d --build
```

Verify service status:

```bash
docker compose ps
```

Verify logs:

```bash
docker compose logs -f core
docker compose logs -f webui
```

## 4. Access Check

- Open `http://localhost`
- Login with configured admin account
- Send a test message in WebUI
- Verify response stream is normal

## 5. Persistence Scope

- Database: `./groups/messages.db`
- Agent Memory: `./groups/{agent}/CLAUDE.md`
- Uploads: `./groups/{agent}/uploads/`

## 6. R7 Backup/Restore Drill

Run drill:

```bash
npm run r7:drill
```

Pass condition:
- `RPO_SECONDS <= 900`
- `RTO_SECONDS <= 1800`
- `R7_BACKUP_RESTORE_DRILL_RESULT=PASS`

Artifacts are generated in `artifacts/r7-drill/<timestamp>/report.txt`.

## 7. R7 Release Check

Run release check:

```bash
npm run r7:release-check
```

Run R7 acceptance bundle:

```bash
npm run r7:acceptance
```
