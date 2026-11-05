#!/bin/bash
# usage: finish.sh <run-dir>  gathers what the coach wrote and the run's cost for the judge.
set -eu
RUN=$1
mkdir -p "$RUN/written/config"
cp -R "$RUN/copy/profile" "$RUN/copy/cv" "$RUN/written/"
cp -R "$RUN/copy/config/competencies" "$RUN/written/config/"
[ -d "$RUN/copy/experience-bank" ] && cp -R "$RUN/copy/experience-bank" "$RUN/written/"
tail -1 "$RUN/costlog.txt" | awk '{print "total_usd " $3}' | tee "$RUN/cost.txt"
echo "turns $(grep -c '^## Turn' "$RUN/transcript.md")"
find "$RUN/written" -type f
