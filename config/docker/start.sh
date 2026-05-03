#!/bin/sh
set -e

./manage.py migrate --noinput
./manage.py ensure_s3_bucket
./manage.py update_exchange_rates --if-stale

if [ "$USE_DEBUGPY" = "true" ]; then
  echo '========================================='
  echo 'Starting Django with debugger enabled'
  echo 'Debugger listening on 0.0.0.0:5678'
  echo 'Attach from VS Code, LazyVim, or any DAP client'
  echo '========================================='
  exec python -m debugpy --listen 0.0.0.0:5678 ./manage.py runserver 0.0.0.0:8000 --nothreading --noreload
else
  exec ./manage.py runserver 0.0.0.0:8000
fi
