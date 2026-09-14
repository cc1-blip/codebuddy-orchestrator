const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolveLogFile() {
  const candidates = [
    process.env.CODEBUDDY_LOG_FILE,
    path.resolve(__dirname, 'bridge.log'),
    'C:\\Users\\cz\\plugins\\codebuddy-bridge\\bridge.log',
    path.join(os.homedir(), '.codebuddy-orchestrator', 'bridge.log'),
    path.join(os.homedir(), '.codebuddy-bridge', 'bridge.log'),
    path.join(process.cwd(), 'bridge.log'),
  ].filter(Boolean);

  let bestFile = null;
  let bestMtime = 0;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const stat = fs.statSync(c);
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestFile = c;
        }
      } catch {}
    }
  }
  return bestFile;
}

function resolveTasksFile() {
  const candidates = [
    process.env.CODEBUDDY_TASKS_FILE,
    path.resolve(__dirname, 'tasks.json'),
    'C:\\Users\\cz\\plugins\\codebuddy-bridge\\tasks.json',
    path.join(os.homedir(), '.codebuddy-orchestrator', 'tasks.json'),
    path.join(os.homedir(), '.codebuddy-bridge', 'tasks.json'),
    path.join(process.cwd(), 'tasks.json'),
  ].filter(Boolean);

  let bestFile = null;
  let bestMtime = 0;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const stat = fs.statSync(c);
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestFile = c;
        }
      } catch {}
    }
  }
  return bestFile;
}

function showLogs(options = {}) {
  const logFile = resolveLogFile();
  if (!logFile) {
    console.error('⚠️ 未找到任何运行日志文件 (bridge.log)。请先发起一次任务或启动服务。');
    process.exit(1);
  }

  const linesCount = options.lines || 30;
  const follow = options.follow || false;

  console.log(`[Logs] 日志文件: ${logFile}`);
  console.log('='.repeat(60));

  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split(/\r?\n/).filter(Boolean);
    const tailLines = allLines.slice(-linesCount).join('\n');
    if (tailLines) {
      process.stdout.write(tailLines + '\n');
    }
  } catch (err) {
    console.error(`读取日志失败: ${err.message}`);
    process.exit(1);
  }

  if (follow) {
    console.log('\n--- 🔴 正在实时监听 CodeBuddy 命令行输出流 (按 Ctrl+C 退出) ---');
    let currentSize = 0;
    try {
      currentSize = fs.statSync(logFile).size;
    } catch {}

    const interval = setInterval(() => {
      try {
        if (!fs.existsSync(logFile)) return;
        const newSize = fs.statSync(logFile).size;
        if (newSize > currentSize) {
          const stream = fs.createReadStream(logFile, {
            start: currentSize,
            end: newSize,
            encoding: 'utf8',
          });
          stream.on('data', (chunk) => process.stdout.write(chunk));
          currentSize = newSize;
        }
      } catch {}
    }, 400);

    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\n已退出日志监听。');
      process.exit(0);
    });
  }
}

function showStatus() {
  const tasksFile = resolveTasksFile();
  if (!tasksFile) {
    console.log('⚠️ 当前没有记录到任何任务数据。');
    return;
  }

  try {
    const raw = fs.readFileSync(tasksFile, 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.tasks || [data]);

    console.log('\n==================================================');
    console.log('       CodeBuddy Orchestrator 任务看板');
    console.log(`       数据源: ${tasksFile}`);
    console.log('==================================================\n');

    const running = list.filter((t) => t.status === 'running');
    const recent = list.slice(-5);

    if (running.length > 0) {
      console.log(`🔥 当前正在执行中的后台任务 (${running.length} 个):`);
      for (const t of running) {
        const durationSec = Math.round((Date.now() - t.startedAt) / 1000);
        console.log(`  - [RUNNING] TaskId: ${t.taskId}`);
        console.log(`    模型: ${t.model} | PID: ${t.pid || 'N/A'} | 已耗时: ${durationSec}s`);
        console.log(`    工程: ${t.cwd}`);
        console.log(`    会话: ${t.sessionId}`);
        console.log(`    最新动作: ${t.progress || '正在执行...'}`);
        console.log('');
      }
    } else {
      console.log('🟢 当前无正在运行的任务 (全部已完成或待命)。\n');
    }

    console.log(`📋 最近任务历史记录:`);
    for (const t of recent) {
      const durationSec = t.endedAt ? Math.round((t.endedAt - t.startedAt) / 1000) : 'N/A';
      const statusTag = t.status === 'completed' ? '✅ COMPLETED' : (t.status === 'failed' ? '❌ FAILED' : '⏳ RUNNING');
      console.log(`  ${statusTag} | ${t.taskId} | ${t.model} | 耗时: ${durationSec}s`);
      if (t.error) {
        console.log(`    报错: ${t.error}`);
      } else if (t.progress) {
        console.log(`    最终状态: ${t.progress}`);
      }
    }
    console.log('');
  } catch (err) {
    console.error(`解析 tasks.json 失败: ${err.message}`);
  }
}

module.exports = {
  resolveLogFile,
  resolveTasksFile,
  showLogs,
  showStatus,
};
