#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
ROOT_ENV_BACKUP="$TMP_DIR/root.env.backup"
DEPLOY_ENV_BACKUP="$TMP_DIR/deploy.env.backup"

cleanup() {
  if [[ -f "$ROOT_ENV_BACKUP" ]]; then
    mv "$ROOT_ENV_BACKUP" "$ROOT_DIR/.env"
  else
    rm -f "$ROOT_DIR/.env"
  fi

  if [[ -f "$DEPLOY_ENV_BACKUP" ]]; then
    mv "$DEPLOY_ENV_BACKUP" "$ROOT_DIR/deploy/.env"
  else
    rm -f "$ROOT_DIR/deploy/.env"
  fi

  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run local CI checks."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop or the Docker service, then rerun."
  exit 1
fi

if [[ -f .env ]]; then
  cp .env "$ROOT_ENV_BACKUP"
fi

if [[ -f deploy/.env ]]; then
  cp deploy/.env "$DEPLOY_ENV_BACKUP"
fi

cat > .env <<'EOF'
DB_USER=ci_user
DB_PASSWORD=ci_password
REDIS_PASSWORD=ci_redis_password
EOF

cp deploy/.env.example deploy/.env

echo "[1/3] Validating docker-compose"
docker compose config >/tmp/docker-compose.rendered.yml

echo "[2/3] Building mc-api"
docker build -f apps/api/Dockerfile ./deploy --tag mc-api:ci-local

echo "[3/3] Building mc-app"
docker build -f apps/web/Dockerfile ./deploy --tag mc-app:ci-local

echo "Local CI checks passed."
