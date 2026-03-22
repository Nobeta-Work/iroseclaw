#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$PROJECT_ROOT/scripts/stop-bg.sh"
bash "$PROJECT_ROOT/scripts/start-bg.sh"
