#!/bin/sh
# Keep the engine up during judging: restart it if it ever exits.
cd "$(dirname "$0")"
while true; do
  bun run index.ts >> engine.log 2>&1
  echo "engine exited $(date -u) — restarting" >> engine.log
  sleep 3
done
