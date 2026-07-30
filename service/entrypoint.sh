#!/bin/sh
# brain on loopback, driver on $PORT (Cloud Run's public port).
# The driver's /healthz reports the brain's state, so one probe covers both.
cd /app
# two brain workers: a long audit solve occupies one while live game
# decisions keep landing on the other (the solver is GIL-bound, so extra
# vCPUs only help across processes, never within one)
uvicorn service.brain.main:app --host 127.0.0.1 --port 8081 --workers 2 &
cd service/driver
exec ./node_modules/.bin/tsx index.ts
