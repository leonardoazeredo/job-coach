#!/bin/bash
# usage: turn.sh <run-dir> <n> <reply-file>  turn 1 starts the session, later turns resume it.
RUN=$(cd "$1" && pwd)
N=$2
REPLY=$3
MODEL=${LIVE_RUN_MODEL:-claude-sonnet-5-5}
BUDGET=${LIVE_RUN_BUDGET_USD:-5}

HERE=$(cd "$(dirname "$0")" && pwd)
# run-folder.ts owns the files turn.sh and the scripts after it read; the last cost line is the total.
# A total that cannot be read must not look like 0: the stop would be skipped and the turn paid for.
SPENT=$(node "$HERE/run-folder.ts" total "$RUN") || {
  echo "could not read the running total in $RUN/costlog.txt; no turn was run"
  exit 1
}
if awk -v s="$SPENT" -v b="$BUDGET" 'BEGIN {exit !(s >= b)}'; then
  echo "STOP: $SPENT spent, the stop is $BUDGET. No turn was run."
  exit 3
fi

# What a replay of this turn starts from (replay.ts): the copy without its installed packages, which
# are large and come back with npm ci, and the coach's session, which lives in claudehome.
mkdir -p "$RUN/snap"
tar -czf "$RUN/snap/before$N.tgz" -C "$RUN" --exclude=copy/node_modules copy claudehome
rm -f "$RUN/snap/before$N.packages"
[ -d "$RUN/copy/node_modules" ] && touch "$RUN/snap/before$N.packages"

RESUME=()
[ "$N" -gt 1 ] && RESUME=(--resume "$(node "$HERE/run-folder.ts" session "$RUN")")
echo "[$(date +%T)] turn $N starts (expected 20-90 s, up to ~5 min); tail -f $RUN/raw/turn$N.jsonl"
docker exec "coach-live-run-$(basename "$RUN")" \
  claude -p "$(cat "$REPLY")" "${RESUME[@]+"${RESUME[@]}"}" --model "$MODEL" \
  --max-budget-usd "$BUDGET" --dangerously-skip-permissions --output-format stream-json \
  --verbose >"$RUN/raw/turn$N.jsonl" 2>"$RUN/raw/turn$N.err"
STATUS=$?
echo "[$(date +%T)] turn $N ended, exit $STATUS"

# A turn with no result records nothing: the last cost line must stay the running total, and a
# retry of this turn must not leave two blocks in the transcript.
node "$HERE/run-folder.ts" record "$RUN" "$N" "$REPLY" || exit "$((STATUS ? STATUS : 1))"

cat "$RUN/last.txt"
printf '\n--- cost so far:\n'
node "$HERE/run-folder.ts" total "$RUN"
exit "$STATUS"
