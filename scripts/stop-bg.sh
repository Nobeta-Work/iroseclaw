#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
PID_FILE="$LOG_DIR/koishi.pid"

find_bot_pids() {
  ps -eo pid=,args= | awk -v root="$PROJECT_ROOT" '
    index($0, root "/node_modules/.bin/koishi start") || index($0, root "/node_modules/koishi/lib/worker") {
      print $1
    }
  '
}

pid_candidates=""
if [[ -f "$PID_FILE" ]]; then
  pid_candidates="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

matched_pids="$(find_bot_pids || true)"
all_pids="$(printf '%s\n%s\n' "$pid_candidates" "$matched_pids" | awk 'NF { print $1 }' | sort -u)"

if [[ -z "${all_pids:-}" ]]; then
  rm -f "$PID_FILE"
  echo "Bot is not running."
  exit 0
fi

echo "Stopping bot PIDs:"
printf '%s\n' "$all_pids"

while IFS= read -r pid; do
  kill -TERM "$pid" 2>/dev/null || true
done <<< "$all_pids"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  remaining=""
  while IFS= read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then
      remaining="${remaining}${pid}"$'\n'
    fi
  done <<< "$all_pids"

  if [[ -z "${remaining:-}" ]]; then
    rm -f "$PID_FILE"
    echo "Bot stopped."
    exit 0
  fi

  sleep 1
done

echo "Force killing remaining bot PIDs:"
printf '%s' "$remaining"
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  kill -KILL "$pid" 2>/dev/null || true
done <<< "$remaining"

rm -f "$PID_FILE"
echo "Bot stopped."
