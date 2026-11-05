#!/bin/bash
# usage: turn.sh <run-dir> <n> <reply-file>  turn 1 starts the session, later turns resume it.
RUN=$(cd "$1" && pwd)
N=$2
REPLY=$3
MODEL=${LIVE_RUN_MODEL:-claude-sonnet-5-5}
BUDGET=${LIVE_RUN_BUDGET_USD:-5}

# total_cost_usd is a running total for the session, so the last line is the spend: never sum it.
SPENT=$(tail -1 "$RUN/costlog.txt" 2>/dev/null | awk '{print $3+0}')
if awk -v s="${SPENT:-0}" -v b="$BUDGET" 'BEGIN {exit !(s >= b)}'; then
  echo "STOP: $SPENT spent, the stop is $BUDGET. No turn was run."
  exit 3
fi

RESUME=()
[ "$N" -gt 1 ] && RESUME=(--resume "$(cat "$RUN/session.id")")
echo "[$(date +%T)] turn $N starts (expected 20-90 s, up to ~5 min); tail -f $RUN/raw/turn$N.jsonl"
docker exec "coach-live-run-$(basename "$RUN")" \
  claude -p "$(cat "$REPLY")" "${RESUME[@]+"${RESUME[@]}"}" --model "$MODEL" \
  --max-budget-usd "$BUDGET" --dangerously-skip-permissions --output-format stream-json \
  --verbose >"$RUN/raw/turn$N.jsonl" 2>"$RUN/raw/turn$N.err"
STATUS=$?
echo "[$(date +%T)] turn $N ended, exit $STATUS"

node -e '
const fs = require("node:fs")
const [run, n] = process.argv.slice(1)
let cost = 0, sid = "", text = []
for (const line of fs.readFileSync(`${run}/raw/turn${n}.jsonl`, "utf8").split("\n").filter(Boolean)) {
  const j = JSON.parse(line)
  if (j.type === "result") { cost = j.total_cost_usd; sid = j.session_id }
  if (j.type === "assistant") for (const c of j.message.content) if (c.type === "text") text.push(c.text)
}
if (!sid) process.exit(2)
fs.writeFileSync(`${run}/session.id`, sid)
fs.appendFileSync(`${run}/costlog.txt`, `turn ${n} ${cost}\n`)
fs.writeFileSync(`${run}/last.txt`, text.join("\n\n"))
' "$RUN" "$N" || {
  # A turn with no result records nothing: the last cost line must stay the running total,
  # and a retry of this turn must not leave two blocks in the transcript.
  echo "turn $N left no result; $RUN/raw/turn$N.err holds why"
  exit "$((STATUS ? STATUS : 1))"
}

cp "$REPLY" "$RUN/raw/reply$N.txt"
{
  printf '## Turn %s\n\n**Persona:**\n\n' "$N"
  sed 's/^/> /' "$REPLY"
  printf '\n**Coach:**\n\n'
  sed 's/^/> /' "$RUN/last.txt"
  printf '\n'
} >>"$RUN/transcript.md"

cat "$RUN/last.txt"
printf '\n--- cost so far:\n'
tail -1 "$RUN/costlog.txt" | awk '{print $3}'
exit "$STATUS"
