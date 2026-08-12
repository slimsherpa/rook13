#!/usr/bin/env python3
"""Download the full production game corpus (2026-08-10 deep dive).

Reads PRODUCTION Firestore (project rook13-01) via REST using the local
gcloud CLI token — strictly read-only, same machinery as
prod_trump_audit.py. For every completed game it pulls the whole action
log and the blunders subcollection, unwraps the Firestore value
envelopes, and banks one JSON line per game:

    {"id": ..., "status": ..., "actions": [...], "blunders": [...]}

    ~/torch-env/bin/python scripts/prod_download.py \
        --out runs/prodgames/games.jsonl

Resumable: games already present in --out are skipped.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = ("https://firestore.googleapis.com/v1/projects/rook13-01/"
        "databases/(default)/documents")

_TOKEN = {"v": None, "t": 0}


def token():
    if time.time() - _TOKEN["t"] > 2400:
        _TOKEN["v"] = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]).decode().strip()
        _TOKEN["t"] = time.time()
    return _TOKEN["v"]


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "Authorization": f"Bearer {token()}"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def unwrap(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "timestampValue" in v:
        return v["timestampValue"]
    if "mapValue" in v:
        return {k: unwrap(x) for k, x in
                v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v:
        return [unwrap(x) for x in v["arrayValue"].get("values", [])]
    return None


def unwrap_doc(doc):
    return {k: unwrap(v) for k, v in doc.get("fields", {}).items()}


def list_docs(path, page_size=300, mask=None):
    out = []
    tok = None
    while True:
        url = f"{BASE}/{path}?pageSize={page_size}"
        if mask:
            url += "".join(f"&mask.fieldPaths={m}" for m in mask)
        if tok:
            url += f"&pageToken={tok}"
        d = get(url)
        out.extend(d.get("documents", []))
        tok = d.get("nextPageToken")
        if not tok:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="runs/prodgames/games.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    done = set()
    if os.path.exists(args.out):
        for line in open(args.out):
            try:
                done.add(json.loads(line)["id"])
            except Exception:
                pass
    print(f"{len(done)} games already downloaded", flush=True)

    games = list_docs("games")
    print(f"{len(games)} game docs in production", flush=True)

    todo = []
    for d in games:
        gid = d["name"].rsplit("/", 1)[1]
        f = unwrap_doc(d)
        if f.get("status") != "completed":
            continue
        if gid in done:
            continue
        todo.append((gid, f))
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} completed games to fetch", flush=True)

    with open(args.out, "a") as fh:
        for i, (gid, gdoc) in enumerate(todo):
            docs = list_docs(f"games/{gid}/actions", page_size=300)
            docs.sort(key=lambda d: d["name"])
            actions = [unwrap_doc(d) for d in docs]
            bdocs = list_docs(f"games/{gid}/blunders", page_size=300)
            blunders = [unwrap_doc(d) for d in bdocs]
            rec = {"id": gid,
                   "doc": gdoc,
                   "actions": actions,
                   "blunders": blunders}
            fh.write(json.dumps(rec) + "\n")
            fh.flush()
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(todo)} games "
                      f"({sum(len(a['actions']) for a in [rec])} acts last)",
                      flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
