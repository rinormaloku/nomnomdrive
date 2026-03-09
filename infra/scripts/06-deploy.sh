#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/root/nomnomdrive}"

cd "$REPO_DIR"

echo "==> Pulling latest changes..."
git pull --recurse-submodules
git submodule update --init --recursive

echo "==> Rebuilding and restarting containers..."
docker compose up -d --build

echo "==> Waiting for cloud container to be healthy..."
sleep 5

if docker compose ps --format json | grep -q '"cloud"'; then
  STATE=$(docker compose ps --format '{{.State}}' cloud 2>/dev/null || true)
  if [ "$STATE" = "running" ]; then
    echo "==> Cloud container is running. Last 30 log lines:"
    docker compose logs --tail 30 cloud
    echo ""
    echo "==> Deploy successful."
  else
    echo "==> Cloud container state: $STATE"
    echo "==> Last 50 log lines:"
    docker compose logs --tail 50 cloud
    exit 1
  fi
else
  echo "==> Cloud container not found!"
  docker compose ps
  docker compose logs --tail 50
  exit 1
fi
