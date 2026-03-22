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

running_pids="$(find_bot_pids || true)"
if [[ -n "${running_pids:-}" ]]; then
  printf '%s\n' "$running_pids" | head -n 1 > "$PID_FILE"
  echo "Bot is running."
  echo "PIDs:"
  printf '%s\n' "$running_pids"
  echo "Log: $LOG_FILE"
  exit 0
fi

rm -f "$PID_FILE"
echo "Bot is not running."
echo "Log: $LOG_FILE"
