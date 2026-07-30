#!/bin/sh
# brain on loopback, driver on $PORT (Cloud Run's public port).
# The driver's /healthz reports the brain's state, so one probe covers both.
cd /app
uvicorn service.brain.main:app --host 127.0.0.1 --port 8081 &
cd service/driver
exec ./node_modules/.bin/tsx index.ts
