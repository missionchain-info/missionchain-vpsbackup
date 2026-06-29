# Mission Chain VPS Backup

This repository tracks the current Mission Chain VPS deploy stack and the source used to build the public services.

## Services

- `missionchain.io` -> public website
- `app.missionchain.io` -> `mc-app`
- `admin.missionchain.io` -> `mc-admin`
- `api.missionchain.io` -> `mc-api`
- `missionchain.world` -> `mc-world`

The runtime entrypoint is [`docker-compose.yml`](docker-compose.yml).

## CI Checks

GitHub Actions validates the compose file and builds the two source-based images:

- [`mc-api`](deploy/apps/api/Dockerfile)
- [`mc-app`](deploy/apps/web/Dockerfile)

Run the same checks locally with:

```bash
./scripts/ci-local.sh
```

Notes:

- Docker must be running locally.
- The script temporarily writes CI-safe `.env` files, then restores your original local files on exit.

## Release Flow For `app.missionchain.io`

`mc-app` no longer depends on a manually copied `deploy/apps/web/out` artifact. It now builds directly from source through Docker.

Standard release steps on the VPS:

```bash
cd /opt/missionchain
git pull
./scripts/release-mc-app.sh
```

That script:

1. rebuilds the `mc-app` image from [`deploy/apps/web/Dockerfile`](deploy/apps/web/Dockerfile)
2. recreates the `mc-app` container with Docker Compose
3. prints container status for a quick verification

## Full Stack Refresh

When deploy-related code changes, use this order on the VPS:

```bash
cd /opt/missionchain
git pull
docker compose build mc-api mc-app
docker compose up -d mc-api mc-app
docker compose ps
```

Recommended post-deploy checks:

```bash
curl -I https://app.missionchain.io
curl -I https://admin.missionchain.io
curl https://api.missionchain.io/health
```

## Backup Note

Local and VPS backup snapshots are intentionally kept outside the tracked deploy flow. The `_archive/` directory stays uncommitted unless we explicitly decide otherwise.
