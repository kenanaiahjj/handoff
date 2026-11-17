#!/bin/sh
# Starts the app. Database and object storage are provided by Supabase.
set -e
exec npm run start --workspace @asbir/web -- --hostname 0.0.0.0 --port "${PORT:-3000}"
