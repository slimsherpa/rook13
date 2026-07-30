#!/bin/bash
# Push the MBP's corpus counts to the hub board every 5 min (LaunchAgent
# com.rook13.mbpstats). The hub can't reach the laptop, so the laptop
# reports in; a stale file renders as "asleep" on the board, by design.
cd /Users/rileyadamson/Documents/GitHub/rook13/ml || exit 1
/usr/bin/python3 scripts/corpus_count.py --runs-dir runs \
  --cache runs/.count_cache.json > /tmp/mbp_stats.json 2>/dev/null \
  && /usr/bin/scp -o BatchMode=yes -o ConnectTimeout=8 -q \
     /tmp/mbp_stats.json root@5.78.115.122:/root/status/mbp.json
