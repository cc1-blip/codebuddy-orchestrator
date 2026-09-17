---
name: codebuddy-orchestrator
description: Enterprise-grade Dual-Agent orchestration bridge connecting OpenAI Codex, Google Antigravity, and Claude with Tencent CodeBuddy models (DeepSeek 4.1/Pro, Hunyuan 3.0/4.0, GLM). Enforces zero-polling native OS kernel wait protocols.
---

# CodeBuddy Orchestrator Skill

## Overview
This skill defines the operational standards and toolsets for the **Lead Architect (Host) + Heavy Worker (CodeBuddy)** Dual-Agent architecture.

## Available MCP Tools
- `codebuddy_run`: Dispatches coding tasks to CodeBuddy.
  - **Single Task (Sync)**: Default mode (<4 min). Blocks and returns directly with zero polling.
  - **Heavy Task (Async)**: Pass `async: true`. Returns immediately with `taskId`, `pid`, and `waitCommand`.
- `codebuddy_task_status`: Queries final output and summary of completed tasks (Strictly anti-polling: only call once after waitCommand finishes or for post-hoc debugging).
- `codebuddy_start_webui`: Launches CodeBuddy WebUI daemon on `127.0.0.1:18990` with full CORS and idle auto-shutdown.
- `codebuddy_stop_webui`: Safely terminates the background WebUI daemon immediately.
- `codebuddy_get_status`: Checks whether the WebUI is running, port connectivity, and idle countdown seconds.
- `codebuddy_set_model_ladder`: Configures project model ladder (e.g. preset 'A', 'B', or 'C').
- `codebuddy_get_model_ladder`: Queries current project's model ladder.
- `codebuddy_list_models`: Lists supported model IDs and aliases.
- `codebuddy_list_sessions`: Lists all project sessions.

## Mandatory Architectural Policies

### 1. The Architect-Worker Separation
- **Host Agent (Codex / Antigravity)**: Acts strictly as the **Lead Architect & Independent Reviewer**.
  - Responsibilities: Deconstruct requirements, create implementation plans, dispatch tasks with explicit `Allowed paths`, verify test gates independently, and issue `changes_requested` or `accepted`.
  - Restriction: NEVER jump in to modify worker business code directly while delegating.
- **Worker Agent (CodeBuddy)**: Acts as the **Implementation Engine**.
  - Responsibilities: Heavy code authoring, writing extensive tests, refactoring, logging outputs to `.codex-logs/`, and returning structured handoffs.

### 2. Zero-Polling Kernel Wait Protocol
When launching an asynchronous task (`async: true`):
- **STRICTLY FORBIDDEN**: NEVER use `Start-Sleep` loops, periodic `schedule` timers, or repeated calls to `codebuddy_task_status`.
- **ONE-SHOT KERNEL BLOCKING**:
  - On Windows: Run `powershell -ExecutionPolicy Bypass -File <path>/wait-job.ps1 -TaskId <id> -ProcessId <pid>` or `Wait-Process -Id <pid>`.
  - On macOS/Linux: Run `bash <path>/wait-job.sh --task-id <id> --process-id <pid>`.
- The OS kernel will instantly unblock the calling process the millisecond the worker process exits.

### 3. Model Ladder Failover & Smart Timeout Preservation
- **Alias Normalization & Task-specific Ladder**:
  - Aliases are auto-corrected (e.g. `"4.1"` -> `"deepseek-v4.1-flash"`, `"hy4"` -> `"hy4-preview-f"`).
  - Explicit per-task ladder: Pass `ladder: ["glm-5.3", "hy4-preview-f"]` or chain syntax in `model: "glm-5.3 -> hy4"`. This strictly overrides project presets without unwanted fallbacks.
- **Decoupled Failover (Hard Error vs. Timeout)**:
  - **Hard Errors (429 quota exhaustion, service down, network failures)**: Bridge seamlessly switches to the next candidate model in the ladder within the same session.
  - **Execution Timeouts**: By default (`failover_on_timeout: false`), timeouts do NOT blindly switch models. All modified files and tests on disk are safely preserved, and a structured timeout progress card is returned to the Lead Architect for evaluation.
- **Budget Expansion**:
  - Asynchronous heavy tasks default to a 7200s (2 hours) execution budget. Customize via `timeout_seconds`.

### 4. Real-time Live Streaming Monitor (Generative UI & Zero-Token Observability)
- When launching an asynchronous task (`async: true`), the response includes `monitorUrl` and `embedTag`.
- **In Google Antigravity**: Immediately render `embedTag` (`<agent-embed src="..."></agent-embed>`) in the chat bubble. It renders an interactive dark terminal card directly in DOM via local SSE (`127.0.0.1:18991`), providing millisecond-level code flow, incoming prompt review, action focus, and an abort kill-switch with **0 LLM token consumption**.
- **In OpenAI Codex**: Present `monitorUrl` (`http://127.0.0.1:18991/monitor?taskId=...`) for one-click browser viewing while running `waitCommand` in the terminal.

