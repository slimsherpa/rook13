# Rook13 bot service: FastAPI brain (python, localhost:8081) + Node driver
# (the only writer, $PORT). One container so the hop is loopback.
# Build context = repo root (see .gcloudignore for what ships).
FROM python:3.12-slim

# Node 20 for the driver (runs the app's own TS engine via tsx)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# python deps first (cache layer: torch is the heavy one)
COPY service/brain/requirements.txt service/brain/requirements.txt
RUN pip install --no-cache-dir -r service/brain/requirements.txt

# node deps
COPY service/driver/package.json service/driver/
RUN cd service/driver && npm install --omit=dev

# the lab engine + agents + weights the brain needs
COPY ml/rook ml/rook
COPY ml/alpharook ml/alpharook
COPY ml/models/gen21-cand1.pt ml/models/gen21-cand1.pt
COPY ml/models/gen23-cand1.pt ml/models/gen23-cand1.pt
COPY ml/models/widowbrain-v2.pt ml/models/widowbrain-v2.pt
COPY ml/runs/gen15/best_duel.pt ml/runs/gen15/best_duel.pt

# the app engine (driver imports it directly) + the service itself
COPY src/lib src/lib
COPY service/brain service/brain
COPY service/driver service/driver
COPY service/entrypoint.sh service/entrypoint.sh
RUN chmod +x service/entrypoint.sh

ENV PYTHONUNBUFFERED=1
CMD ["service/entrypoint.sh"]
