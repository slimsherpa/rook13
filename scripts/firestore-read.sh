#!/bin/bash
# Read-only Firestore REST reader for rook13-01 — lets Claude replay the
# real family ladder without touching logins. GET only, path pinned to
# this project's documents endpoint. Allowlisted in .claude/settings.local.json.
# Usage: bash scripts/firestore-read.sh "users?pageSize=300"
#        bash scripts/firestore-read.sh "users/<uid>/history?pageSize=300"
set -euo pipefail
TOKEN=$(gcloud auth print-access-token)
exec curl -sf --get -H "Authorization: Bearer ${TOKEN}" \
  "https://firestore.googleapis.com/v1/projects/rook13-01/databases/(default)/documents/${1}"
