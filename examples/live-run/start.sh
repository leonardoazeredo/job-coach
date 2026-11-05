#!/bin/bash
# usage: start.sh <run-dir>  builds what a brand-new user has, from this checkout's HEAD:
# no profile, no installed packages, no remote. The coach installs what it needs itself.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
RUN=$1
if [ -e "$RUN/copy" ]; then echo "$RUN already holds a run; choose a new folder." >&2; exit 1; fi

echo "[$(date +%T)] building the image (up to a few minutes the first time)"
docker build -q --build-arg NODE_VERSION="$(cat "$ROOT/.nvmrc")" -t coach-live-run "$HERE" >/dev/null

mkdir -p "$RUN"/copy "$RUN"/raw "$RUN"/claudehome "$RUN"/cachehome "$RUN"/tmpd
git -C "$ROOT" archive HEAD | tar -x -C "$RUN/copy"
# The persona's brief and the judge's checklist would tell the coach what is being measured.
rm -rf "$RUN/copy/profile" "$RUN/copy/examples/personas" "$RUN/copy/examples/live-run" \
  "$RUN/copy/scripts/__tests__/personas-briefs.test.ts"
git -C "$RUN/copy" init -q -b main
git -C "$RUN/copy" add -A
# A machine's own commit hooks have no say over a fresh user's first commit.
git -C "$RUN/copy" -c user.name=Persona -c user.email=persona@example.com \
  commit -q --no-verify -m "Initial copy"
chmod -R a+rwX "$RUN"
git -C "$ROOT" rev-parse --short HEAD >"$RUN/commit.txt"
echo "[$(date +%T)] ready: commit $(cat "$RUN/commit.txt") in $RUN"
