param(
  [Parameter(Mandatory=$false, Position=0)]
  [string]$TaskId = "",

  [Parameter(Mandatory=$false)]
  [int]$ProcessId = 0,

  [Parameter(Mandatory=$false)]
  [int]$TimeoutSeconds = 1200,

  [Parameter(Mandatory=$false)]
  [string]$TasksFile = ""
)

$ErrorActionPreference = "Stop"

# Resolve TasksFile dynamically if not explicitly specified
if ([string]::IsNullOrWhiteSpace($TasksFile)) {
  if ($env:CODEBUDDY_TASKS_FILE -and (Test-Path -LiteralPath $env:CODEBUDDY_TASKS_FILE)) {
    $TasksFile = $env:CODEBUDDY_TASKS_FILE
  } else {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $candidates = @(
      (Join-Path $scriptDir "..\src\tasks.json"),
      (Join-Path $HOME ".codebuddy-orchestrator\tasks.json"),
      (Join-Path $HOME ".codebuddy-bridge\tasks.json"),
      (Join-Path (Get-Location) "tasks.json")
    )
    foreach ($c in $candidates) {
      if (Test-Path -LiteralPath $c) {
        $TasksFile = (Resolve-Path -LiteralPath $c).Path
        break
      }
    }
    if ([string]::IsNullOrWhiteSpace($TasksFile)) {
      $TasksFile = (Join-Path $scriptDir "..\src\tasks.json")
    }
  }
}

# 1. Enforce minimum timeout to prevent accidental disguised polling
if ($TimeoutSeconds -lt 600) {
  Write-Warning "[WAIT-JOB] TimeoutSeconds ($TimeoutSeconds) is too short. Resetting to 1200s to enforce One-Shot wait policy."
  $TimeoutSeconds = 1200
}

# 2. Resolve target PID
$targetPid = $ProcessId

if ($targetPid -le 0 -and $TaskId -ne "" -and (Test-Path -LiteralPath $TasksFile)) {
  try {
    $tasksContent = [System.IO.File]::ReadAllText($TasksFile)
    $tasksData = $tasksContent | ConvertFrom-Json
    if ($tasksData -is [System.Array]) {
      $matched = $tasksData | Where-Object { $_.taskId -eq $TaskId } | Select-Object -Last 1
      if ($matched -and $matched.pid) {
        $targetPid = [int]$matched.pid
      }
    } elseif ($tasksData -and $tasksData.taskId -eq $TaskId -and $tasksData.pid) {
      $targetPid = [int]$tasksData.pid
    }
  } catch {
    # Ignore parse error and proceed to fallback
  }
}

# 3. If target PID is found and running, perform native OS kernel wait
if ($targetPid -gt 0) {
  $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Output "=================================================="
    Write-Output "[WAIT-JOB] Waiting for process PID $targetPid (Task: $TaskId) in One-Shot mode..."
    Write-Output "Policy: Native OS Kernel Wait | Timeout: ${TimeoutSeconds}s"
    Write-Output "Zero Polling: System will resume instantly upon process exit."
    Write-Output "=================================================="

    try {
      $startTime = Get-Date
      $lastLine = ""
      while ($proc -and -not $proc.HasExited) {
        $hasExited = $proc.WaitForExit(3000)
        if ($hasExited) { break }

        $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
        if ($elapsed -ge $TimeoutSeconds) {
          throw "Wait timed out after ${TimeoutSeconds}s"
        }

        # Check latest progress from tasks.json to provide live transparent heartbeat
        if ($TaskId -ne "" -and (Test-Path -LiteralPath $TasksFile)) {
          try {
            $tContent = [System.IO.File]::ReadAllText($TasksFile)
            $tData = $tContent | ConvertFrom-Json
            $cur = $null
            if ($tData -is [System.Array]) {
              $cur = $tData | Where-Object { $_.taskId -eq $TaskId } | Select-Object -Last 1
            } elseif ($tData -and $tData.taskId -eq $TaskId) {
              $cur = $tData
            }
            if ($cur -and $cur.progress -and $cur.progress -ne $lastLine) {
              $lastLine = $cur.progress
              $preview = if ($lastLine.Length -gt 90) { $lastLine.Substring(0, 87) + "..." } else { $lastLine }
              Write-Output "[WAIT-JOB +${elapsed}s] $preview"
            }
          } catch {}
        }
      }
      Write-Output "[WAIT-JOB] Process PID $targetPid exited cleanly."
    } catch {
      Write-Error "[WAIT-JOB] Process wait error or timeout: $_"
      exit 1
    }
  } else {
    Write-Output "[WAIT-JOB] Process PID $targetPid is already finished."
  }
} else {
  Write-Output "[WAIT-JOB] No active process PID found for task $TaskId. Checking completed task record..."
}

# 4. Small settle delay to allow bridge to flush task completion and token stats
Start-Sleep -Milliseconds 800

# 5. Fetch and display final task output and token dashboard
$taskFound = $false
if ($TaskId -ne "" -and (Test-Path -LiteralPath $TasksFile)) {
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      $tasksContent = [System.IO.File]::ReadAllText($TasksFile)
      $tasksData = $tasksContent | ConvertFrom-Json
      $matched = $null
      if ($tasksData -is [System.Array]) {
        $matched = $tasksData | Where-Object { $_.taskId -eq $TaskId } | Select-Object -Last 1
      } elseif ($tasksData -and $tasksData.taskId -eq $TaskId) {
        $matched = $tasksData
      }

      if ($matched -and ($matched.status -eq 'completed' -or $matched.status -eq 'failed')) {
        $taskFound = $true
        Write-Output ""
        Write-Output "=================================================="
        Write-Output "[TASK RESULT] TaskId: $($matched.taskId) | Status: $($matched.status) | Duration: $($matched.durationSeconds)s"
        Write-Output "Model: $($matched.model) | Session: $($matched.sessionId)"
        Write-Output "=================================================="
        if ($matched.output) {
          Write-Output $matched.output
        }
        if ($matched.status -eq 'failed') {
          Write-Output "Error: $($matched.error)"
          exit 1
        }
        exit 0
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
}

if (-not $taskFound) {
  Write-Output "[WAIT-JOB] Process wait concluded. Task execution finished."
  exit 0
}
