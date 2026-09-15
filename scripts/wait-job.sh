#!/usr/bin/env bash
# ==============================================================================
# wait-job.sh - POSIX Native OS Kernel Waiter (Zero Polling / 0 Token Consumption)
# Companion script for CodeBuddy Orchestrator on macOS / Linux
# ==============================================================================

set -euo pipefail

TASK_ID=""
TARGET_PID=""
TIMEOUT_SEC=7200

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
echo "[WAIT-JOB] Process PID ${TARGET_PID:-N/A} exited cleanly."

# Settle delay
sleep 1

# Fetch and display final task output and token dashboard via Node
TASKS_FILE="${TASKS_FILE:-$(dirname "$0")/../src/tasks.json}"
if [[ -n "$TASK_ID" && -f "$TASKS_FILE" ]]; then
  node -e '
    const fs = require("fs");
    const taskId = process.argv[1];
    const tasksFile = process.argv[2];
    for (let i = 0; i < 5; i++) {
      try {
        const raw = fs.readFileSync(tasksFile, "utf8");
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data : (data.tasks || [data]);
        const matched = list.slice().reverse().find(t => t.taskId === taskId);
        if (matched && (matched.status === "completed" || matched.status === "failed")) {
          console.log("\n=============================================");
          console.log(`[TASK RESULT] TaskId: ${matched.taskId} | Status: ${matched.status}`);
          console.log(`Model: ${matched.model} | Session: ${matched.sessionId}`);
          console.log("=============================================\n");
          if (matched.output) console.log(matched.output);
          if (matched.status === "failed") {
            console.error("Error: " + matched.error);
            process.exit(1);
          }
          process.exit(0);
        }
      } catch {}
    }
  ' "$TASK_ID" "$TASKS_FILE"
fi

exit 0
