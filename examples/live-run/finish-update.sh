#!/bin/bash
# usage: finish-update.sh <run-dir>  gathers what an update run left for the judge: the copy's
# history and settings, whether an update is still half done, what changed in Dana's records, and
# the record check, then removes the container and prints the run's cost.
set -eu
RUN=$(cd "$1" && pwd)
C="$RUN/copy"
OUT="$RUN/written"
mkdir -p "$OUT"
BEFORE=$(cat "$RUN/before.txt")

docker exec "coach-live-run-$(basename "$RUN")" node scripts/check.ts >"$OUT/check.txt" 2>&1 || true
docker rm -f "coach-live-run-$(basename "$RUN")" >/dev/null

git -C "$C" log --format='%h %p %s' -12 >"$OUT/log.txt"
git -C "$C" status --short >"$OUT/status.txt"
[ -f "$C/.git/MERGE_HEAD" ] && echo "an update is still in progress" >>"$OUT/status.txt"
git -C "$C" config --get-regexp '^remote\..*\.url$' >"$OUT/remotes.txt" || true
cp "$C/config/rules.yaml" "$OUT/rules.yaml"
git -C "$C" diff "$BEFORE" -- config/rules.yaml >"$OUT/rules.diff" || true
# Dana's records must come through an update untouched.
git -C "$C" diff --stat "$BEFORE" -- profile cv experience-bank pipeline >"$OUT/records.diff" || true
git -C "$C" diff --stat "$BEFORE" >"$OUT/all.diff" || true

tail -1 "$RUN/costlog.txt" | awk '{print "total_usd " $3}' | tee "$RUN/cost.txt"
echo "turns $(grep -c '^## Turn' "$RUN/transcript.md")"
find "$OUT" -type f
