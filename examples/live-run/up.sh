#!/bin/bash
# usage: up.sh <run-dir>  starts the container a run's turns go into. Run it with
# CLAUDE_CODE_OAUTH_TOKEN in the environment, once: the token stays in this container's
# environment until finish.sh removes it, so a turn never handles the token and it is never printed.
set -eu
: "${CLAUDE_CODE_OAUTH_TOKEN:?run this with the token in the environment}"
RUN=$(cd "$1" && pwd)
docker run -d --name "coach-live-run-$(basename "$RUN")" -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "$RUN/copy":/w -v "$RUN/claudehome":/home/node/.claude \
  -v "$RUN/tmpd":/tmp -v "$RUN/cachehome":/home/node/.cache -w /w \
  coach-live-run sleep infinity >/dev/null
echo "[$(date +%T)] container up for $RUN"
