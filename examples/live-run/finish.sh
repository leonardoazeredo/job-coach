#!/bin/bash
# usage: finish.sh <run-dir>  gathers what the coach wrote and the run's cost for the judge.
set -eu
RUN=$(cd "$1" && pwd)
docker rm -f "coach-live-run-$(basename "$RUN")" >/dev/null
mkdir -p "$RUN/written/config"
cp -R "$RUN/copy/profile" "$RUN/copy/cv" "$RUN/written/"
cp -R "$RUN/copy/config/competencies" "$RUN/written/config/"
[ -d "$RUN/copy/experience-bank" ] && cp -R "$RUN/copy/experience-bank" "$RUN/written/"
HERE=$(cd "$(dirname "$0")" && pwd)
echo "total_usd $(node "$HERE/run-folder.ts" total "$RUN")" | tee "$RUN/cost.txt"
echo "turns $(node "$HERE/run-folder.ts" turns "$RUN")"
find "$RUN/written" -type f
