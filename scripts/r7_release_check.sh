#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"
DEPLOYMENT_FILE="$ROOT_DIR/DEPLOYMENT.md"
CHECKLIST_FILE="$ROOT_DIR/DEPLOYMENT_CHECKLIST.md"

ERRORS=0

require_file() {
  if [ ! -f "$1" ]; then
    echo "MISSING_FILE=$1"
    ERRORS=$((ERRORS + 1))
  fi
}

require_file "$COMPOSE_FILE"
require_file "$ENV_EXAMPLE_FILE"
require_file "$DEPLOYMENT_FILE"
require_file "$CHECKLIST_FILE"

if [ -f "$COMPOSE_FILE" ]; then
  if grep -E "sk-[A-Za-z0-9_-]{16,}" "$COMPOSE_FILE" >/dev/null 2>&1; then
    echo "COMPOSE_SECRET_CHECK=FAIL"
    ERRORS=$((ERRORS + 1))
  else
    echo "COMPOSE_SECRET_CHECK=PASS"
  fi
fi

if [ -f "$ENV_EXAMPLE_FILE" ]; then
  REQUIRED_KEYS=(
    "ANTHROPIC_BASE_URL="
    "ANTHROPIC_AUTH_TOKEN="
    "MODEL_NAME="
    "AUTH_SECRET="
    "ADMIN_PASSWORD="
  )
  for key in "${REQUIRED_KEYS[@]}"; do
    if ! grep -F "$key" "$ENV_EXAMPLE_FILE" >/dev/null 2>&1; then
      echo "ENV_KEY_CHECK_FAIL=$key"
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "R7_RELEASE_CHECK=FAIL"
  exit 1
fi

echo "R7_RELEASE_CHECK=PASS"
