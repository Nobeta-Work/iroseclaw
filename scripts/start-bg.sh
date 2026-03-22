#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/bot.log"
PID_FILE="$LOG_DIR/koishi.pid"

find_bot_pids() {
  ps -eo pid=,args= | awk -v root="$PROJECT_ROOT" '
    index($0, root "/node_modules/.bin/koishi start") || index($0, root "/node_modules/koishi/lib/worker") {
      print $1
    }
  '
}

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

running_pids="$(find_bot_pids || true)"
if [[ -n "${running_pids:-}" ]]; then
  printf '%s\n' "$running_pids" | head -n 1 > "$PID_FILE"
  echo "Bot is already running."
  echo "PIDs:"
  printf '%s\n' "$running_pids"
  echo "Log: $LOG_FILE"
  exit 0
fi

nohup setsid bash -lc "cd '$PROJECT_ROOT' && npm run dev" >> "$LOG_FILE" 2>&1 &
pid=$!
printf '%s\n' "$pid" > "$PID_FILE"

sleep 2
if kill -0 "$pid" 2>/dev/null; then
  echo "Bot started in background."
  echo "PID: $pid"
  echo "Log: $LOG_FILE"
  exit 0
fi

echo "Bot failed to start. Check log: $LOG_FILE" >&2
exit 1
