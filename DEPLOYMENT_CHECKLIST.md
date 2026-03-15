# NanoClaw Deployment Checklist

## Pre-Deploy

- [ ] `.env` created from `.env.example`
- [ ] `AUTH_SECRET` set
- [ ] `ADMIN_PASSWORD` set
- [ ] `ANTHROPIC_AUTH_TOKEN` set
- [ ] No hard-coded secret remains in `docker-compose.yml`

## Deploy

- [ ] `docker compose up -d --build` succeeded
- [ ] `docker compose ps` shows `nginx`, `webui`, `core` as running
- [ ] Web entry `http://localhost` is reachable

## R7 Drill

- [ ] `npm run r7:drill` succeeded
- [ ] `RPO_SECONDS <= 900`
- [ ] `RTO_SECONDS <= 1800`
- [ ] Drill report archived under `artifacts/r7-drill/`

## Compliance Gate

- [ ] `npm run r7:release-check` succeeded
- [ ] `TC-NCW-DEPLOY-001` execution evidence linked
- [ ] `TC-NCW-COMP-*` execution evidence linked

## Final Gate

- [ ] `npm run r7:acceptance` succeeded
- [ ] OpenSpec `tasks.md` and `qa-test-cases.md` updated with latest evidence
- [ ] PMO R7 status moved to `Ready for Acceptance` after evidence complete
