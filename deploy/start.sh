#!/bin/sh
# Starts the app. With LITESTREAM_REPLICA_URL set, an empty volume is restored from the latest
# backup first, then the database is backed up continuously while the app runs.
set -e
DB="${ASBIR_DATA_DIR:-/var/lib/asbir-handoff}/asbir-handoff.sqlite"
APP="npm run start --workspace @asbir/web -- --hostname 0.0.0.0 --port ${PORT:-3000}"

if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  if [ ! -f "$DB" ]; then
    echo "[start] No database on the volume; restoring the latest backup if one exists."
    litestream restore -config /etc/litestream.yml -if-replica-exists "$DB"
  fi
  exec litestream replicate -config /etc/litestream.yml -exec "$APP"
fi

echo "[start] LITESTREAM_REPLICA_URL is not set: running without continuous database backups."
exec $APP
