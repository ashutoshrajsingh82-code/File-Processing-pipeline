#!/bin/sh
celery -A celery_worker.celery_app worker --loglevel=INFO --concurrency=1 --pool=solo &
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-10000}"
