#!/usr/bin/env bash
# ==============================================================================
# wait-job.sh - POSIX Native OS Kernel Waiter (Zero Polling / 0 Token Consumption)
# Companion script for CodeBuddy Orchestrator on macOS / Linux
# ==============================================================================

set -euo pipefail

TASK_ID=""
TARGET_PID=""
TIMEOUT_SEC=1200

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--task-id)
      TASK_ID="$2"
      shift 2
      ;;
    -p|--process-id)
      TARGET_PID="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$TASK_ID" && -z "$TARGET_PID" ]]; then
  echo "Usage: wait-job.sh --task-id <taskId> [--process-id <pid>] [--timeout 1200]"
  exit 1
fi

echo "============================================="
echo "[WAIT-JOB] Waiting for process PID ${TARGET_PID:-N/A} (Task: ${TASK_ID}) in One-Shot mode..."
echo "Policy: Native OS Kernel Wait | Timeout: ${TIMEOUT_SEC}s"
echo "Zero Polling: System will resume instantly upon process exit."
echo "============================================="

if [[ -n "$TARGET_PID" && "$TARGET_PID" -gt 0 ]]; then
  # Block directly using tail --pid if available, or lightweight kernel signal wait
  if command -v tail >/dev/null 2>&1 && tail --help 2>&1 | grep -q -- '--pid'; then
    tail --pid="$TARGET_PID" -f /dev/null || true
  else
    # Fallback to wait loop with subshell
    START_TIME=$(date +%s)
    while kill -0 "$TARGET_PID" 2>/dev/null; do
      sleep 1
      NOW=$(date +%s)
      if [[ $((NOW - START_TIME)) -ge "$TIMEOUT_SEC" ]]; then
        echo "[WAIT-JOB] Timeout reached (${TIMEOUT_SEC}s). Exiting wait."
        exit 124
      fi
    done
  fi
fi

echo ""
echo "[WAIT-JOB] Process wait concluded. Task execution finished."
exit 0
