#!/bin/bash
# usage: start-update.sh <run-dir>  builds what an onboarded user has just before an update, from
# this checkout's HEAD. The copy was made with "Use this template" from HEAD and holds the fictional
# Dana Okafor's records (examples/austin-backend) plus one setting she changed. A local engine one
# version ahead changed the same setting. The copy reaches that engine at the engine's real address
# through a git rewrite, so the coach's update runs as it would against GitHub.
# Needs CLAUDE_CODE_OAUTH_TOKEN in the environment, for up.sh.
set -euo pipefail
: "${CLAUDE_CODE_OAUTH_TOKEN:?run this with the token in the environment}"
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
RUN=$1
if [ -e "$RUN/copy" ]; then
  echo "$RUN already holds a run; choose a new folder." >&2
  exit 1
fi
PERSONA="$ROOT/examples/austin-backend"
ENGINE_URL=https://github.com/leonardoazeredo/job-coach.git

echo "[$(date +%T)] building the image (up to a few minutes the first time)"
docker build -q --build-arg NODE_VERSION="$(cat "$ROOT/.nvmrc")" -t coach-live-run "$HERE" >/dev/null

mkdir -p "$RUN"/copy "$RUN"/raw "$RUN"/claudehome "$RUN"/cachehome "$RUN"/tmpd "$RUN"/engine-work

# Fixed dates keep the order the change list depends on: the engine's base, then the copy made from
# it, then Dana's own saves, then the engine's next version.
at() { GIT_AUTHOR_DATE=$1 GIT_COMMITTER_DATE=$1 git -C "$2" -c user.name=Persona \
  -c user.email=persona@example.com commit -q --no-verify -m "$3"; }
tree() {
  git -C "$ROOT" archive HEAD | tar -x -C "$1"
  # The persona's brief and the judge's checklist would tell the coach what is being measured.
  rm -rf "$1/examples/personas" "$1/examples/live-run" "$1/scripts/__tests__/personas-briefs.test.ts"
}

E="$RUN/engine-work"
tree "$E"
git -C "$E" init -q -b main
git -C "$E" add -A
at 2026-10-01T09:00:00Z "$E" "Engine"

C="$RUN/copy"
tree "$C"
git -C "$C" init -q -b main
git -C "$C" add -A
at 2026-10-02T09:00:00Z "$C" "Initial commit"
cp -R "$PERSONA/profile" "$PERSONA/cv" "$PERSONA/experience-bank" "$C/"
for role in "$PERSONA"/pipeline/*/; do
  # No trailing slash: on macOS it would copy the folder's contents instead of the folder.
  [ "$(basename "$role")" = _templates ] || cp -R "${role%/}" "$C/pipeline/"
done
cp "$PERSONA/config/competencies/backend.yaml" "$C/config/competencies/"
git -C "$C" add -A
at 2026-10-03T09:00:00Z "$C" "Saved: profile and roles"
# Dana asked for a role with no reply to count as stale sooner than the engine's default.
sed -i.bak 's/^  applied_no_response_days: 14 /  applied_no_response_days: 10 /' "$C/config/rules.yaml"
rm "$C/config/rules.yaml.bak"
grep -q '^  applied_no_response_days: 10 ' "$C/config/rules.yaml"
git -C "$C" add -A
at 2026-10-04T09:00:00Z "$C" "Updated: settings"

# The next version: the same setting changed, a neighbouring one changed, and a guide reworded.
sed -i.bak -e 's/^  applied_no_response_days: 14 /  applied_no_response_days: 21 /' \
  -e 's/^  post_interview_follow_up_business_days: 5$/  post_interview_follow_up_business_days: 3/' \
  "$E/config/rules.yaml"
rm "$E/config/rules.yaml.bak"
grep -q '^  applied_no_response_days: 21 ' "$E/config/rules.yaml"
grep -q '^  post_interview_follow_up_business_days: 3$' "$E/config/rules.yaml"
git -C "$E" add -A
at 2026-10-10T09:00:00Z "$E" "Roles with no reply count as stale after 21 days, and interview follow-ups come after 3 working days"
printf '\nA tailored CV is checked against its job ad before it is exported.\n' >>"$E/docs/cv-for-role.md"
git -C "$E" add -A
at 2026-10-11T09:00:00Z "$E" "Clearer steps in the guide to a CV for one role"
git clone -q --bare "$E" "$RUN/engine"
rm -rf "$E"

# Inside the container the engine is at /engine; the coach still asks for the real address.
git -C "$C" config "url./engine.insteadOf" "$ENGINE_URL"
chmod -R a+rwX "$RUN"
git -C "$ROOT" rev-parse --short HEAD >"$RUN/commit.txt"
git -C "$C" rev-parse HEAD >"$RUN/before.txt"
"$HERE/up.sh" "$RUN"

echo "[$(date +%T)] installing the coach's packages and checking Dana's records (about a minute)"
docker exec "coach-live-run-$(basename "$RUN")" sh -c 'npm ci --silent >/dev/null && node scripts/check.ts | tail -1'
echo "[$(date +%T)] ready: commit $(cat "$RUN/commit.txt") in $RUN"
