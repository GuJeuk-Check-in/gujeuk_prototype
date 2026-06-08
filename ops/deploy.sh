#!/usr/bin/env sh
set -eu

REPOSITORY_DIR="${REPOSITORY_DIR:-/home/ubuntu/git/gujeuk_prototype}"

cd "$REPOSITORY_DIR"
git fetch origin main
git checkout main
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
docker compose ps
