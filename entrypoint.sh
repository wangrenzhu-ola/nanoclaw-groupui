#!/bin/sh
set -e

# Wait for Docker daemon to be ready
echo "Waiting for Docker daemon..."
timeout=30
while ! docker info >/dev/null 2>&1; do
  timeout=$(($timeout - 1))
  if [ $timeout -eq 0 ]; then
    echo "Timed out waiting for Docker daemon"
    exit 1
  fi
  sleep 1
done
echo "Docker daemon is ready"

# Start the application
exec node dist/index.js
