const { spawn, execFile, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

function resolveBinary(name, candidates = []) {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${name}` : `which ${name}`;
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/[\r\n]+/)[0].trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return name;
}

const CODEBUDDY_BIN = resolveBinary('codebuddy', [
  'D:\\agentmesh-tools\\codebuddy\\codebuddy.cmd',
  path.join(os.homedir(), '.agentmesh-tools', 'codebuddy', 'codebuddy.cmd'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codebuddy.cmd'),
  '/usr/local/bin/codebuddy',
  '/opt/homebrew/bin/codebuddy',
]);
const NODE_BIN = fs.existsSync('D:\\node\\node.exe')
  ? 'D:\\node\\node.exe'
  : (process.execPath || 'node');
const CODEBUDDY_JS = resolveBinary('codebuddy', [
  'D:\\agentmesh-tools\\codebuddy\\node_modules\\@tencent-ai\\codebuddy-code\\bin\\codebuddy',
  path.join(os.homedir(), '.agentmesh-tools', 'codebuddy', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy'),
  '/usr/local/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy',
  '/opt/homebrew/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy',
]);

const LOG_FILE = path.join(__dirname, 'bridge.log');
const PID_FILE = path.join(__dirname, 'daemon.pid');
const SESSIONS_CONFIG_FILE = path.join(__dirname, 'sessions.json');
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const LOCKS_DIR = path.join(__dirname, '.locks');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

let activeDaemon = null;
let activePort = 18990;
let activeHost = '127.0.0.1';
let activeWebUIUrl = null;

// --- 空闲自动停机定时器 ---
const DEFAULT_IDLE_TIMEOUT_MS = 25 * 60 * 1000; // 默认 25 分钟
let idleTimer = null;
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
let lastActivityTime = Date.now();

function touchActivity() {
  lastActivityTime = Date.now();
  armIdleTimer();
}

function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (idleTimeoutMs <= 0) return;

  idleTimer = setTimeout(async () => {
    try {
      // P1-1: 若仍有后台长任务在运行，严禁误杀其依赖的 WebUI，自动重新计时
      const activeRunning = Array.from(runningTasks.values()).filter(t => t.status === 'running');
      if (activeRunning.length > 0) {
        log(`[IdleWatcher] 检测到 ${activeRunning.length} 个后台长任务运行中，暂缓空闲停机并重新计时`);
        armIdleTimer();
        return;
      }
      const status = await getStatus();
      if (status.status === 'running') {
        log(`[IdleWatcher] 空闲超时 (${Math.round(idleTimeoutMs / 60000)} 分钟无活动)，自动停止 WebUI 服务释放资源`);
        await stopWebUI();
      }
    } catch (e) {
      log(`[IdleWatcher] 自动停机执行异常: ${e.message}`);
    }
  }, idleTimeoutMs);
}

// --- 模型阶梯配置与预设 (Model Ladder) ---
const MODEL_LADDER_PRESETS = {
  A: {
    name: '方案 A【深度攻坚组合】',
    description: '首选 DeepSeek-V4-Pro (强力攻坚编码) -> 次选 混元 3.0 (稳定主力) -> 兜底 DeepSeek-V4.1-Flash',
    ladder: ['deepseek-v4-pro', 'hy3', 'deepseek-v4.1-flash'],
  },
  B: {
    name: '方案 B【均衡主力组合】',
    description: '首选 腾讯混元 3.0 (日常开发基石) -> 次选 智谱 GLM-5.3 (架构与重构) -> 兜底 混元 3.0-X',
    ladder: ['hy3', 'glm-5.3', 'hy3-x'],
  },
  C: {
    name: '方案 C【极速响应组合】',
    description: '首选 DeepSeek-V4.1-Flash (极速轻量) -> 次选 智谱 GLM-5.3-Flash -> 兜底 腾讯混元 3.0',
    ladder: ['deepseek-v4.1-flash', 'glm-5.3-flash', 'hy3'],
  },
};
const DEFAULT_PRESET = 'A';

// --- 模型别名归一化与防篡改字典 ---
// 规范模型 ID 清单（与 listModels 保持一致），用于别名 Key 补齐与未知模型兜底
const KNOWN_MODEL_IDS = [
  'hy4-preview-f',
  'hy3',
  'hy3-x',
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2',
  'kimi-k3-1',
  'kimi-k2.8-preview',
  'minimax-m3',
];

const MODEL_ALIASES = {
  '4.1': 'deepseek-v4.1-flash',
  'v4.1': 'deepseek-v4.1-flash',
  'deepseek4.1': 'deepseek-v4.1-flash',
  'deepseek-4.1': 'deepseek-v4.1-flash',
  '4.1flash': 'deepseek-v4.1-flash',
  'deepseek-v4.1': 'deepseek-v4.1-flash',
  'deepseek-v4-flash': 'deepseek-v4.1-flash',
  'deepseek-flash': 'deepseek-v4.1-flash',
  'flash': 'deepseek-v4.1-flash',
  'pro': 'deepseek-v4-pro',
  'v4pro': 'deepseek-v4-pro',
  'deepseekpro': 'deepseek-v4-pro',
  'deepseek-pro': 'deepseek-v4-pro',
  'deepseek-v4': 'deepseek-v4-pro',
  'hy4': 'hy4-preview-f',
  'hunyuan4': 'hy4-preview-f',
  '混元4': 'hy4-preview-f',
  'hy4-preview': 'hy4-preview-f',
  'hy3': 'hy3',
  'hunyuan3': 'hy3',
  '混元3': 'hy3',
  'hy3-x': 'hy3-x',
  'glm5.3': 'glm-5.3',
  'glm-5.3': 'glm-5.3',
  'glm5.3flash': 'glm-5.3-flash',
  'glm-5.3-flash': 'glm-5.3-flash',
  'glm-flash': 'glm-5.3-flash',
};

// 将规范 ID 及其"去符号版本"（去掉空格/下划线/连字符）全部收录为别名 Key，
// 保证 normalizeModel 对规范 ID 幂等，且对大小写混合输入（如 DeepSeek-V4.1-Flash）稳定归一。
for (const id of KNOWN_MODEL_IDS) {
  MODEL_ALIASES[id] = id;
  MODEL_ALIASES[id.replace(/[\s_\-]/g, '')] = id;
}

function normalizeModel(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return null;
  const trimmed = rawModel.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const cleanKey = lower.replace(/[\s_\-]/g, '');
  const hit = MODEL_ALIASES[cleanKey] || MODEL_ALIASES[lower];
  if (hit) return hit;
  // 未知模型兜底：统一返回小写，规避 CLI 对模型 ID 大小写敏感导致的识别失败
  return lower;
}

// --- 会话与工程并发互斥锁 (Cross-Process Session & Workspace Mutex) ---
// 允许同工程内多 Agent 使用不同 session_id 并发协同；仅拦截对同一 session_id 的重复写操作。
// 锁以文件形式持久化于 .locks/ 目录，实现跨进程（多 MCP 客户端）互斥。
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 分钟未更新视为 stale
const HOSTNAME = os.hostname();
const heldLockPaths = new Set(); // 本进程持有的锁文件路径，退出时统一回收

function ensureLocksDir() {
  try {
    if (!fs.existsSync(LOCKS_DIR)) fs.mkdirSync(LOCKS_DIR, { recursive: true });
  } catch (e) {
    log(`创建锁目录失败: ${e.message}`);
  }
}

function getLockFilePath(cwd, sessionId) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const key = `${resolvedCwd}::${sessionId || 'default'}`;
  const hash = crypto.createHash('sha1').update(key.toLowerCase()).digest('hex').slice(0, 16);
  return path.join(LOCKS_DIR, `${hash}.lock`);
}

// 跨进程存活探测：kill(pid, 0) 不发送信号，仅做权限/存在性检查
function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM 表示进程存在但当前用户无权限；ESRCH 表示进程已不存在
    return !!e && e.code === 'EPERM';
  }
}

function readLockFile(lockPath) {
  try {
    if (!fs.existsSync(lockPath)) return null;
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function acquireSessionLock(cwd, sessionId, meta = {}) {
  ensureLocksDir();
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const lockPath = getLockFilePath(resolvedCwd, sessionId);
  const existing = readLockFile(lockPath);

  if (existing) {
    const ageMs = Date.now() - (existing.startedAt || 0);
    // 若锁来自其它主机，无法用 kill 探测，只能依赖 stale 超时判定
    const sameHost = !existing.hostname || existing.hostname === HOSTNAME;
    const stillHeld = sameHost ? isProcessAlive(existing.pid) : true;
    if (stillHeld && ageMs < LOCK_STALE_MS) {
      const durationSec = Math.round(ageMs / 1000);
      return {
        acquired: false,
        message: `[会话保护] 当前会话 [${existing.sessionId || sessionId}] 已有任务正在运行中 (PID: ${existing.pid}, 已运行 ${durationSec} 秒, 任务ID: ${existing.taskId || 'sync'}, 模型: ${existing.model || '未知'})。请等待当前调用返回后再继续向同一会话追加指令。`,
      };
    }
    log(`[SessionLock] 回收 stale 锁 (pid=${existing.pid}, alive=${stillHeld}, age=${Math.round(ageMs / 1000)}s)`);
    try { fs.unlinkSync(lockPath); } catch {}
    heldLockPaths.delete(lockPath);
  }

  const record = {
    pid: process.pid,
    hostname: HOSTNAME,
    sessionId: sessionId || 'default',
    model: meta.model || null,
    taskId: meta.taskId || 'sync',
    startedAt: Date.now(),
    cwd: resolvedCwd,
  };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf8');
    heldLockPaths.add(lockPath);
  } catch (e) {
    // 锁文件写入失败时降级为"无锁执行"，避免因 IO 异常彻底阻断任务
    log(`写入锁文件失败，降级为无锁执行: ${e.message}`);
  }
  return { acquired: true, lockPath };
}

function releaseSessionLock(cwd, sessionId) {
  const lockPath = getLockFilePath(cwd, sessionId);
  try {
    const existing = readLockFile(lockPath);
    // 仅当锁归属本进程（或已不可读）时才删除，避免误删其它进程持有的锁
    if (!existing || existing.pid === process.pid) {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  } catch {}
  heldLockPaths.delete(lockPath);
}

// --- 执行消耗与性能指标抓取 (Session Usage & Performance Stats) ---
function getSessionUsageStats(targetCwd, sessionId, startTimestamp = 0) {
  try {
    const slug = path.resolve(targetCwd).replace(/[:\\/]+/g, '-').replace(/^[-]+/, '');
    const userHome = os.homedir();
    const jsonlPath = path.join(userHome, '.codebuddy', 'projects', slug, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) return null;

    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    let promptTokens = 0;
    let cacheHitTokens = 0;
    let cacheMissTokens = 0;
    let completionTokens = 0;
    let thinkingTokens = 0;
    let totalTokens = 0;
    let credit = 0;
    let turnCount = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        if (startTimestamp > 0 && obj.timestamp && obj.timestamp < startTimestamp) {
          continue;
        }
        const raw = obj?.providerData?.rawUsage;
        if (raw && (typeof raw.prompt_tokens === 'number' || typeof raw.total_tokens === 'number')) {
          promptTokens += (raw.prompt_tokens || 0);
          const hit = raw.prompt_cache_hit_tokens || 0;
          cacheHitTokens += hit;
          cacheMissTokens += (raw.prompt_cache_miss_tokens || Math.max(0, (raw.prompt_tokens || 0) - hit));
          completionTokens += (raw.completion_tokens || 0);
          thinkingTokens += (raw.completion_thinking_tokens || 0);
          totalTokens += (raw.total_tokens || 0);
          credit += (raw.credit || 0);
          turnCount++;
        }
      } catch {}
    }

    if (turnCount === 0) {
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(lines[i]);
          const raw = obj?.providerData?.rawUsage;
          if (raw && (typeof raw.prompt_tokens === 'number' || typeof raw.total_tokens === 'number')) {
            const hit = raw.prompt_cache_hit_tokens || 0;
            return {
              promptTokens: raw.prompt_tokens || 0,
              cacheHitTokens: hit,
              cacheMissTokens: raw.prompt_cache_miss_tokens || Math.max(0, (raw.prompt_tokens || 0) - hit),
              completionTokens: raw.completion_tokens || 0,
              thinkingTokens: raw.completion_thinking_tokens || 0,
              totalTokens: raw.total_tokens || 0,
              credit: raw.credit || 0,
              turnCount: 1,
            };
          }
        } catch {}
      }
      return null;
    }

    return {
      promptTokens,
      cacheHitTokens,
      cacheMissTokens,
      completionTokens,
      thinkingTokens,
      totalTokens,
      credit,
      turnCount,
    };
  } catch {}
  return null;
}

function formatUsageSummaryCard(stats, durationMs, modelName, sessionId) {
  const durationSec = (durationMs / 1000).toFixed(1);
  const timeStr = durationMs >= 60000
    ? `${Math.floor(durationMs / 60000)} 分 ${Math.round((durationMs % 60000) / 1000)} 秒 (${durationSec}s)`
    : `${durationSec} 秒`;

  const sessionShort = sessionId ? sessionId.slice(-12) : '';

  if (!stats) {
    return [
      '\n\n────────────────────────────────────────────────────',
      `📊 **CodeBuddy 执行统计** ${sessionShort ? `(会话: \`...${sessionShort}\`)` : ''}`,
      `* **生效模型**：\`${modelName || '未知'}\``,
      `* **实际耗时**：\`${timeStr}\``,
      '────────────────────────────────────────────────────',
    ].join('\n');
  }

  const hitRate = stats.promptTokens > 0
    ? ((stats.cacheHitTokens / stats.promptTokens) * 100).toFixed(1)
    : '0.0';

  const lines = [
    '\n\n────────────────────────────────────────────────────',
    `📊 **CodeBuddy 执行消耗与性能统计** ${sessionShort ? `(会话: \`...${sessionShort}\`)` : ''}`,
    `* **生效模型**：\`${modelName}\``,
    `* **实际耗时**：\`${timeStr}\`${stats.turnCount > 1 ? ` (共完成 \`${stats.turnCount}\` 轮链式交互)` : ''}`,
    `* **缓存命中输入 (Cache Hit)**：\`${stats.cacheHitTokens.toLocaleString()}\` tokens (🔥 **命中率 ${hitRate}%**) `,
    `* **新计算输入 (Cache Miss)**：\`${stats.cacheMissTokens.toLocaleString()}\` tokens`,
    `* **生成输出 (Output)**：\`${stats.completionTokens.toLocaleString()}\` tokens${stats.thinkingTokens > 0 ? ` (含深度思考 \`${stats.thinkingTokens.toLocaleString()}\` tokens)` : ''}`,
    `* **总交互量 (Total)**：\`${stats.totalTokens.toLocaleString()}\` tokens`,
  ];

  if (typeof stats.credit === 'number') {
    lines.push(`* **算力消耗 (Credit)**：\`${stats.credit > 0 ? stats.credit.toFixed(2) : '0.00'}\` 点`);
  }

  lines.push('────────────────────────────────────────────────────');
  return lines.join('\n');
}

// --- 异步后台长任务管理 (Async Task Manager) ---
const runningTasks = new Map(); // taskId -> { taskId, cwd, model, sessionId, status, startedAt, endedAt, progress, output, error }
const MAX_COMPLETED_TASKS = 25;

function saveTasks() {
  try {
    const arr = Array.from(runningTasks.values());
    fs.writeFileSync(TASKS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    log(`保存 tasks.json 失败: ${e.message}`);
  }
}

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (!runningTasks.has(t.taskId)) {
            runningTasks.set(t.taskId, t);
          } else {
            // 合并磁盘上的更新
            const existing = runningTasks.get(t.taskId);
            if (t.endedAt && !existing.endedAt) {
              runningTasks.set(t.taskId, t);
            }
          }
        }
      }
    }
  } catch {}
}

loadTasks();

function cleanupOldTasks() {
  const completed = Array.from(runningTasks.values()).filter(t => t.status !== 'running');
  if (completed.length > MAX_COMPLETED_TASKS) {
    completed.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
    while (completed.length > MAX_COMPLETED_TASKS) {
      const oldest = completed.shift();
      runningTasks.delete(oldest.taskId);
    }
  }
  saveTasks();
}

function loadSessionsConfig() {
  try {
    if (fs.existsSync(SESSIONS_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveSessionsConfig(cfg) {
  try {
    fs.writeFileSync(SESSIONS_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    log(`保存 sessions.json 失败: ${e.message}`);
  }
}

function getProjectConfig(targetCwd) {
  const resolved = path.resolve(targetCwd || process.cwd()).toLowerCase();
  const cfg = loadSessionsConfig();
  return cfg[resolved] || null;
}

function setProjectConfig(targetCwd, updateObj) {
  const resolved = path.resolve(targetCwd || process.cwd()).toLowerCase();
  const cfg = loadSessionsConfig();
  cfg[resolved] = { ...(cfg[resolved] || {}), ...updateObj, updatedAt: Date.now() };
  saveSessionsConfig(cfg);
  return cfg[resolved];
}

function resolveProjectLadder(targetCwd) {
  const pCfg = getProjectConfig(targetCwd);
  if (pCfg && Array.isArray(pCfg.modelLadder) && pCfg.modelLadder.length > 0) {
    return pCfg.modelLadder.map(m => normalizeModel(m) || m);
  }
  return MODEL_LADDER_PRESETS[DEFAULT_PRESET].ladder.map(m => normalizeModel(m) || m);
}

// --- 工程专属固定 Session ID 生成器 ---
function getProjectSessionId(targetCwd) {
  const resolved = path.resolve(targetCwd || process.cwd());
  const folder = path.basename(resolved).replace(/[^a-zA-Z0-9_\-]/g, '') || 'workspace';
  const hash = crypto.createHash('md5').update(resolved.toLowerCase()).digest('hex').slice(0, 8);
  return `cb-${folder}-${hash}`;
}

// --- 端口与网络探测 ---
function checkPortListening(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isConnected = false;
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      isConnected = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function findAvailablePort(startPort = 18990, host = '127.0.0.1', maxRange = 50) {
  for (let p = startPort; p < startPort + maxRange; p++) {
    const isBusy = await checkPortListening(p, host);
    if (!isBusy) return p;
  }
  throw new Error(`在范围 ${startPort} - ${startPort + maxRange} 内未找到可用空闲端口`);
}

async function waitForPort(port, host = '127.0.0.1', maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ok = await checkPortListening(port, host, 500);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// --- REST API 客户端 ---
const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-codebuddy-request': '1',
};

// --- 统一活跃端口来源 (P1-2) ---
// 优先采用 daemon.pid 中持久化的 { port, url }（且 PID 进程仍存活），
// 避免进程重启后全局 activePort 漂移导致连接旧端口失败。
function resolveActiveTarget() {
  const saved = readPersistedInfo();
  if (saved && saved.port && isProcessAlive(saved.pid)) {
    return {
      port: saved.port,
      host: activeHost,
      url: saved.url || null,
      pid: saved.pid,
      source: 'persisted',
    };
  }
  return {
    port: activePort,
    host: activeHost,
    url: activeWebUIUrl,
    pid: (activeDaemon && activeDaemon.pid) || null,
    source: 'runtime',
  };
}

function resolveActivePort() {
  return resolveActiveTarget().port;
}

async function checkApiOnline(port = null, host = null) {
  const target = resolveActiveTarget();
  const p = port || target.port;
  const h = host || target.host;
  try {
    const res = await fetch(`http://${h}:${p}/api/v1/health`, {
      headers: API_HEADERS,
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function apiRequest(endpoint, method = 'GET', body = null, timeoutMs = 15000) {
  const target = resolveActiveTarget();
  const url = `http://${target.host}:${target.port}${endpoint}`;
  const options = {
    method,
    headers: API_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${method} ${endpoint} 失败 [${res.status}]: ${errText}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// --- 进程生命周期与 PID 管理 ---
function savePid(pid, port, url) {
  try {
    fs.writeFileSync(PID_FILE, JSON.stringify({ pid, port, url, startedAt: Date.now() }, null, 2));
  } catch (e) {
    log(`写入 PID 文件失败: ${e.message}`);
  }
}

function clearPid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {}
}

function readPersistedInfo() {
  try {
    if (fs.existsSync(PID_FILE)) return JSON.parse(fs.readFileSync(PID_FILE, 'utf-8'));
  } catch {}
  return null;
}

function cleanupProcess(pid) {
  if (!pid) return;
  try {
    log(`尝试回收进程 PID=${pid} (platform=${process.platform})`);
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /t /f`, { windowsHide: true, stdio: 'ignore' });
    } else {
      // POSIX：优先整组清理（要求子进程以 detached:true 建组），失败则回退单进程强杀
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
  } catch {}
}

// --- 启动与停止 WebUI ---
async function startWebUI(options = {}) {
  touchActivity();
  const preferredPort = options.port || 18990;
  const host = options.host || '127.0.0.1';
  const workspaceDir = options.workspaceDir || options.cwd || process.cwd();

  if (typeof options.idleMinutes === 'number') {
    idleTimeoutMs = options.idleMinutes * 60 * 1000;
  }

  const saved = readPersistedInfo();
  if (saved && saved.port) {
    const isStillActive = await checkPortListening(saved.port, host);
    if (isStillActive) {
      log(`复用已有 CodeBuddy WebUI 服务 (PID=${saved.pid}, Port=${saved.port})`);
      let resolvedUrl = saved.url;
      if (workspaceDir && !resolvedUrl.includes('folder=')) {
        resolvedUrl += `${resolvedUrl.includes('?') ? '&' : '?'}folder=${encodeURIComponent(workspaceDir)}`;
      }
      activePort = saved.port;
      activeHost = host;
      activeWebUIUrl = resolvedUrl;
      armIdleTimer();
      return {
        status: 'already_running',
        url: resolvedUrl,
        port: saved.port,
        host,
        pid: saved.pid,
        idleTimeoutMinutes: Math.round(idleTimeoutMs / 60000),
        message: `复用已在运行的 CodeBuddy WebUI 服务: ${resolvedUrl}`,
      };
    } else {
      cleanupProcess(saved.pid);
      clearPid();
    }
  }

  const port = await findAvailablePort(preferredPort, host);
  activePort = port;
  activeHost = host;

  // P0-3: 精确绑定本地来源，消除通配符 '*' 带来的本地 CSRF / 远程网页滥用风险
  const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`].join(',');
  const env = {
    ...process.env,
    CODEBUDDY_DISABLE_CHILD_PROCESS_CONTAINMENT: '1',
    CODEBUDDY_CODE_CORS_ORIGINS: allowedOrigins,
  };

  const spawnArgs = ['--serve', '--port', String(port), '--host', host, '--auth', 'none'];
  if (workspaceDir && fs.existsSync(workspaceDir)) {
    spawnArgs.push('--add-dir', workspaceDir);
  }

  log(`启动 CodeBuddy WebUI 进程: ${CODEBUDDY_BIN} ${spawnArgs.join(' ')} (CORS: ${allowedOrigins})`);

  const child = spawn(CODEBUDDY_BIN, spawnArgs, {
    env,
    shell: true,
    windowsHide: true,
    cwd: workspaceDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX 下建独立进程组，便于 stopWebUI 整组回收
    detached: process.platform !== 'win32',
  });

  activeDaemon = child;
  child.stdout.on('data', (d) => log(`[daemon stdout] ${d.toString()}`));
  child.stderr.on('data', (d) => log(`[daemon stderr] ${d.toString()}`));

  child.on('exit', (code, sig) => {
    log(`Daemon 退出 code=${code}, signal=${sig}`);
    if (activeDaemon === child) {
      activeDaemon = null;
      activeWebUIUrl = null;
      clearPid();
    }
  });

  const isReady = await waitForPort(port, host, 15000);
  if (!isReady) {
    cleanupProcess(child.pid);
    throw new Error(`启动 CodeBuddy WebUI 超时，端口 ${port} 在 15 秒内未响应`);
  }

  let fullUrl = `http://${host}:${port}/`;
  if (workspaceDir) fullUrl += `?folder=${encodeURIComponent(workspaceDir)}`;

  activeWebUIUrl = fullUrl;
  savePid(child.pid, port, fullUrl);
  armIdleTimer();

  log(`CodeBuddy WebUI 服务成功就绪: ${fullUrl}`);
  return {
    status: 'started',
    url: fullUrl,
    port,
    host,
    pid: child.pid,
    workspaceDir,
    idleTimeoutMinutes: Math.round(idleTimeoutMs / 60000),
    message: `CodeBuddy WebUI 服务已成功启动 (端口 ${port})，支持 REST API 与前端界面，自动空闲保护已开启`,
  };
}

async function stopWebUI() {
  if (idleTimer) clearTimeout(idleTimer);
  const target = resolveActiveTarget();
  const saved = readPersistedInfo();
  const pidToKill = (activeDaemon && activeDaemon.pid) || (saved && saved.pid) || target.pid;

  if (pidToKill) {
    cleanupProcess(pidToKill);
    activeDaemon = null;
    activeWebUIUrl = null;
    clearPid();
  }

  const isStillListening = await checkPortListening(target.port, target.host);
  if (isStillListening) {
    return { status: 'warn', message: `已发送终止信号，但端口 ${target.port} 仍处于占用中` };
  }
  return { status: 'stopped', message: `CodeBuddy WebUI 服务已完全停止，资源已释放` };
}

async function getStatus() {
  touchActivity();
  const target = resolveActiveTarget();
  const portToCheck = target.port;
  const isListening = await checkPortListening(portToCheck, target.host);
  const isApiReady = isListening ? await checkApiOnline(portToCheck, target.host) : false;

  const remainingIdleSec = Math.max(0, Math.round((idleTimeoutMs - (Date.now() - lastActivityTime)) / 1000));

  return {
    status: isListening ? 'running' : 'stopped',
    apiOnline: isApiReady,
    url: isListening ? (activeWebUIUrl || target.url || `http://${target.host}:${portToCheck}`) : null,
    port: portToCheck,
    host: target.host,
    pid: target.pid || null,
    idleTimeoutRemainingSeconds: isListening ? remainingIdleSec : 0,
  };
}

// --- 错误判定辅助函数 ---
function isQuotaOrRateLimitError(errText) {
  if (!errText) return false;
  return /(?:quota|额度|429|rate\s*limit|balance|insufficient|exhausted|欠费|overloaded|超出限额|余额不足|tokens?\s*exceeded)/i.test(errText);
}

function isPermissionBlockedError(errText) {
  if (!errText) return false;
  return /(?:permission|权限|approval|授权|denied|未授权)/i.test(errText);
}

// 模型不可用判定：刻意限定在"模型 + 错误语义"的组合上，
// 避免误伤 stderr/stdout 中回显的 `--model xxx` 命令行（否则所有失败都会被判为模型错误并触发无意义接力）
function isModelUnavailableError(errText) {
  if (!errText) return false;
  return /(?:model|模型)\s*(?:not\s*found|不存在|未找到|不可用|未知|无效|unknown|invalid)|(?:unknown|invalid|unrecognized|unsupported)\s+model/i.test(errText);
}

function isNetworkError(errText) {
  if (!errText) return false;
  return /(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket\s+hang\s+up|fetch\s+failed|network\s+error|network\s+request\s+failed|连接超时|网络(?:错误|异常|故障))/i.test(errText);
}

// --- 单次执行底层调用（含实时流式心跳） ---
function runPromptCLISingle(prompt, model, cwd, sessionId, timeoutMs, permissionMode, onProgress = null, onSpawn = null) {
  return new Promise((resolve) => {
    log(`[CLI 执行单次] prompt length=${prompt.length}, model=${model}, cwd=${cwd}, sessionId=${sessionId}, timeoutMs=${timeoutMs}, permissionMode=${permissionMode}`);

    const args = [
      CODEBUDDY_JS,
      '-p', prompt,
      '--model', model,
      '--session-id', sessionId,
      '-y',
      '--permission-mode', permissionMode,
    ];

    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let timer = null;

    const child = spawn(NODE_BIN, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX 下建独立进程组，使超时清理可整组 SIGKILL 回收
      detached: process.platform !== 'win32',
    });

    if (typeof onSpawn === 'function' && child.pid) {
      try { onSpawn(child.pid); } catch {}
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        log(`[CLI 执行单次] 超时 (${timeoutMs}ms)，终止进程 PID=${child.pid}`);
        cleanupProcess(child.pid);
      }, timeoutMs);
    }

    const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rlOut.on('line', (line) => {
      stdoutData += line + '\n';
      const trimmed = line.trim();
      if (trimmed) {
        log(`[CLI stdout:${model}] ${trimmed.slice(0, 160)}`);
        if (typeof onProgress === 'function') {
          try { onProgress(trimmed); } catch {}
        }
      }
    });

    const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
    rlErr.on('line', (line) => {
      stderrData += line + '\n';
      const trimmed = line.trim();
      if (trimmed) {
        log(`[CLI stderr:${model}] ${trimmed.slice(0, 160)}`);
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      log(`[CLI 执行单次] 启动异常 (model=${model}): ${err.message}`);
      resolve({
        success: false,
        details: err.message,
        isQuota: false,
        isPermission: false,
        isTimeout: false,
        isModelError: isModelUnavailableError(err.message),
        isNetworkError: isNetworkError(err.message),
      });
    });

    child.on('close', async (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        return resolve({
          success: false,
          details: `执行超时 (${Math.round(timeoutMs / 1000)} 秒)`,
          isQuota: false,
          isPermission: false,
          isTimeout: true,
          isModelError: false,
          isNetworkError: false,
        });
      }

      if (code !== 0) {
        const detail = (stderrData || stdoutData || `进程退出码: ${code}`).trim();
        log(`[CLI 执行单次] 失败 (model=${model}, code=${code}): ${detail.slice(0, 300)}`);
        return resolve({
          success: false,
          details: detail,
          isQuota: isQuotaOrRateLimitError(detail),
          isPermission: isPermissionBlockedError(detail),
          isTimeout: false,
          isModelError: isModelUnavailableError(detail),
          isNetworkError: isNetworkError(detail),
        });
      }

      log(`[CLI 执行单次] 成功 (model=${model}), 输出长度: ${stdoutData.length}`);

      // 若 WebUI 在线，同步将会话重命名为工程语义清晰的标题
      try {
        const isOnline = await checkApiOnline();
        if (isOnline) {
          const folder = path.basename(path.resolve(cwd));
          await apiRequest(`/api/v1/sessions/${sessionId}/rename`, 'POST', {
            name: `[${folder}] 工程专属会话`,
          }).catch(() => {});
        }
      } catch {}

      resolve({
        success: true,
        output: stdoutData.trim(),
      });
    });
  });
}

// --- 核心执行引擎：模型别名纠偏 + 模型梯队自愈 + 工程并发锁 ---
async function runPrompt(
  prompt,
  model = null,
  cwd = process.cwd(),
  sessionId = null,
  newSession = false,
  timeoutMs = 600000,
  permissionMode = 'bypassPermissions',
  onProgress = null,
  isAlreadyLocked = false,
  onSpawn = null
) {
  touchActivity();
  const startTime = Date.now();

  const resolvedCwd = path.resolve(cwd || process.cwd());
  let targetSessionId = sessionId;

  if (newSession) {
    targetSessionId = `${getProjectSessionId(resolvedCwd)}-${Date.now().toString(36)}`;
  } else if (!targetSessionId) {
    targetSessionId = getProjectSessionId(resolvedCwd);
  }

  // 1. 模型解析与别名纠偏策略
  const normalizedInputModel = normalizeModel(model);
  let candidateModels = [];

  if (normalizedInputModel) {
    candidateModels = [normalizedInputModel];
    // 将项目阶梯中的其它模型作为降级备选
    const projectLadder = resolveProjectLadder(resolvedCwd);
    for (const m of projectLadder) {
      const normM = normalizeModel(m);
      if (!candidateModels.includes(normM)) candidateModels.push(normM);
    }
  } else {
    candidateModels = resolveProjectLadder(resolvedCwd);
  }

  // 2. 工程并发锁检查
  let weAcquiredLock = false;
  if (!isAlreadyLocked) {
    const lockRes = acquireSessionLock(resolvedCwd, targetSessionId, {
      sessionId: targetSessionId,
      model: candidateModels[0],
      taskId: 'sync',
    });
    if (!lockRes.acquired) {
      return lockRes.message;
    }
    weAcquiredLock = true;
  }

  try {
    let lastError = null;
    const failoverNotices = [];

    for (let i = 0; i < candidateModels.length; i++) {
      const curModel = candidateModels[i];
      log(`[任务执行] 尝试模型 [${i + 1}/${candidateModels.length}]: ${curModel}, session=${targetSessionId}`);

      const res = await runPromptCLISingle(
        prompt,
        curModel,
        resolvedCwd,
        targetSessionId,
        timeoutMs,
        permissionMode,
        onProgress,
        onSpawn
      );

      if (res.success) {
        let finalOutput = res.output;
        if (failoverNotices.length > 0) {
          finalOutput = `> ⚠️ **模型自动故障接力通知**：\n> ${failoverNotices.join('\n> ')}\n\n` + finalOutput;
        }
        const durationMs = Date.now() - startTime;
        const stats = getSessionUsageStats(resolvedCwd, targetSessionId, startTime);
        finalOutput = finalOutput + formatUsageSummaryCard(stats, durationMs, curModel, targetSessionId);
        return finalOutput;
      }

      // 检查是否为权限拦截
      if (res.isPermission) {
        try {
          const webui = await startWebUI({ cwd: resolvedCwd });
          return `⚠️ 当前操作触发了安全确认限制，命令行非交互无法放行：\n\n${res.details}\n\n👉 已为您自动唤起 WebUI 控制台：${webui.url}\n您可以在浏览器中打开该链接进行人工点击授权，或在后续任务中细化授权范围。`;
        } catch {}
        throw new Error(res.details);
      }

      // 检查是否可触发模型阶梯自愈接力：额度限流 / 执行超时 / 模型不可用 / 网络故障
      const isFailoverCandidate = res.isQuota || res.isTimeout || res.isModelError || res.isNetworkError;
      if (isFailoverCandidate && i < candidateModels.length - 1) {
        const nextModel = candidateModels[i + 1];
        const reasons = [];
        if (res.isQuota) reasons.push('额度不足或触发限流 (429)');
        if (res.isTimeout) reasons.push('执行超时');
        if (res.isModelError) reasons.push('模型不可用');
        if (res.isNetworkError) reasons.push('网络故障');
        const notice = `模型 \`${curModel}\` ${reasons.join(' / ')}，已自动无缝切换至 \`${nextModel}\` 继续执行当前会话。`;
        log(`[Failover] ${notice}`);
        failoverNotices.push(notice);
        continue;
      }

      lastError = res.details;
      break;
    }

    throw new Error(lastError || '任务执行失败');
  } finally {
    if (weAcquiredLock) {
      releaseSessionLock(resolvedCwd, targetSessionId);
    }
  }
}

// --- 异步后台长任务执行调度 ---
async function startAsyncTask(args, timeoutMs) {
  touchActivity();
  const resolvedCwd = path.resolve(args.cwd || process.cwd());
  const normalizedInput = normalizeModel(args.model);
  const targetModel = normalizedInput || resolveProjectLadder(resolvedCwd)[0];
  const targetSessionId = args.new_session
    ? `${getProjectSessionId(resolvedCwd)}-${Date.now().toString(36)}`
    : (args.session_id || getProjectSessionId(resolvedCwd));

  const taskId = `task-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;

  const lockRes = acquireSessionLock(resolvedCwd, targetSessionId, {
    taskId,
    sessionId: targetSessionId,
    model: targetModel,
  });
  if (!lockRes.acquired) {
    return JSON.stringify({
      status: 'rejected',
      message: lockRes.message,
    }, null, 2);
  }

  const taskRecord = {
    taskId,
    pid: null,
    cwd: resolvedCwd,
    model: targetModel,
    sessionId: targetSessionId,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    progress: '任务已启动，正在初始化 CLI 进程...',
    output: '',
    error: null,
  };

  runningTasks.set(taskId, taskRecord);
  saveTasks();
  cleanupOldTasks();

  let spawnResolver;
  const spawnPromise = new Promise((resolve) => { spawnResolver = resolve; });
  const spawnTimeout = setTimeout(() => spawnResolver(null), 400);

  // 异步在后台推进，不占用 MCP 当前工具调用时长
  (async () => {
    try {
      const result = await runPrompt(
        args.prompt,
        args.model || null,
        args.cwd,
        targetSessionId,
        false, // 已预先分配 targetSessionId，避免重复生成不同 session ID
        timeoutMs,
        args.permission_mode || 'bypassPermissions',
        (line) => {
          taskRecord.progress = line;
          saveTasks();
        },
        true, // isAlreadyLocked
        (pid) => {
          taskRecord.pid = pid;
          saveTasks();
          clearTimeout(spawnTimeout);
          spawnResolver(pid);
        }
      );
      taskRecord.status = 'completed';
      taskRecord.output = result;
      taskRecord.endedAt = Date.now();
      taskRecord.progress = '执行成功完成';
      saveTasks();
    } catch (err) {
      taskRecord.status = 'failed';
      taskRecord.error = err.message;
      taskRecord.endedAt = Date.now();
      taskRecord.progress = `执行失败: ${err.message}`;
      saveTasks();
    } finally {
      releaseSessionLock(resolvedCwd, targetSessionId);
    }
  })();

  const spawnedPid = await spawnPromise;
  const isWin = process.platform === 'win32';
  const localPs1 = path.resolve(__dirname, '..', 'scripts', 'wait-job.ps1');
  const codexPs1 = path.join(os.homedir(), '.codex', 'scripts', 'wait-job.ps1');
  const targetPs1 = fs.existsSync(codexPs1) ? codexPs1 : localPs1;
  const localSh = path.resolve(__dirname, '..', 'scripts', 'wait-job.sh');

  let waitCmd = '';
  if (isWin) {
    waitCmd = spawnedPid
      ? `powershell -ExecutionPolicy Bypass -File "${targetPs1}" -TaskId "${taskId}" -ProcessId ${spawnedPid}`
      : `powershell -ExecutionPolicy Bypass -File "${targetPs1}" -TaskId "${taskId}"`;
  } else {
    waitCmd = spawnedPid
      ? `bash "${localSh}" --task-id "${taskId}" --process-id ${spawnedPid}`
      : `bash "${localSh}" --task-id "${taskId}"`;
  }

  return JSON.stringify({
    status: 'started',
    taskId,
    pid: spawnedPid || null,
    sessionId: targetSessionId,
    model: targetModel,
    cwd: resolvedCwd,
    waitCommand: waitCmd,
    policy: [
      '【严禁轮询】严禁使用 Start-Sleep 或任何短 timeout 的循环（如 -Timeout 55）；',
      '【唯一步骤】请直接以 One-Shot 模式执行上方 waitCommand 一次性等待完成；',
      '【即时唤醒】系统会在进程退出瞬间由操作系统内核直接放行，中途不得发起任何检查。'
    ],
    message: '【异步长任务已在后台启动】不受任何 MCP 客户端 300 秒超时限制。请立即以 One-Shot 模式执行上方 waitCommand 等待其自然完成并获取结果。',
  }, null, 2);
}

function getTaskStatus(taskId, filterCwd) {
  touchActivity();
  loadTasks();
  if (taskId && runningTasks.has(taskId)) {
    const t = runningTasks.get(taskId);
    const durationSec = Math.round(((t.endedAt || Date.now()) - t.startedAt) / 1000);
    return JSON.stringify({
      taskId: t.taskId,
      status: t.status,
      durationSeconds: durationSec,
      model: t.model,
      cwd: t.cwd,
      sessionId: t.sessionId,
      latestProgress: t.progress,
      output: t.output || (t.error ? `错误: ${t.error}` : '(运行中，暂无最终输出)'),
    }, null, 2);
  }

  const list = Array.from(runningTasks.values())
    .filter(t => !filterCwd || path.resolve(t.cwd).toLowerCase() === path.resolve(filterCwd).toLowerCase())
    .map(t => ({
      taskId: t.taskId,
      status: t.status,
      durationSeconds: Math.round(((t.endedAt || Date.now()) - t.startedAt) / 1000),
      model: t.model,
      cwd: t.cwd,
      latestProgress: t.progress,
    }));

  return JSON.stringify({
    activeTasksCount: list.filter(t => t.status === 'running').length,
    tasks: list,
  }, null, 2);
}

function listModels() {
  touchActivity();
  return [
    { id: 'hy4-preview-f', name: '腾讯混元 4 Preview', description: '腾讯自研新一代混元大模型预览版 (别名: hy4, 混元4)' },
    { id: 'hy3', name: '腾讯混元 3.0', description: '腾讯主力旗舰大模型，通用编码与深度推理 (别名: hy3, 混元3)' },
    { id: 'hy3-x', name: '腾讯混元 3.0-X', description: '混元增强版推理模型' },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', description: 'DeepSeek 4.1 高速轻量大模型 (别名: 4.1, deepseek4.1, flash)' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: 'DeepSeek 编程主力大模型 (别名: pro, deepseek-pro)' },
    { id: 'glm-5.3', name: '智谱 GLM-5.3', description: '智谱最新一代旗舰大模型' },
    { id: 'glm-5.3-flash', name: '智谱 GLM-5.3-Flash', description: '智谱极速轻量大模型' },
    { id: 'glm-5.2', name: '智谱 GLM-5.2', description: '智谱成熟大模型' },
    { id: 'kimi-k3-1', name: 'Kimi K3.1', description: '超长上下文与逻辑推理大模型' },
    { id: 'kimi-k2.8-preview', name: 'Kimi K2.8-Preview', description: 'Kimi 新一代预览版模型' },
    { id: 'minimax-m3', name: 'MiniMax M3', description: 'MiniMax 编码与多语言大模型' },
  ];
}

// --- 进程退出清理 ---
process.on('exit', () => {
  if (activeDaemon && activeDaemon.pid) {
    cleanupProcess(activeDaemon.pid);
  }
  // 回收本进程持有的所有会话锁文件，避免残留导致后续任务被永锁
  for (const lockPath of heldLockPaths) {
    try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch {}
  }
  heldLockPaths.clear();
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// --- MCP 工具集合 (9 个核心工具) ---
const TOOLS = [
  {
    name: 'codebuddy_start_webui',
    description: '启动 CodeBuddy WebUI 守护进程（支持跨域穿透、无密码访问与自动空闲停机回收）',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: '期望监听端口，默认 18990' },
        host: { type: 'string', description: '绑定主机地址，默认 127.0.0.1' },
        workspaceDir: { type: 'string', description: '关联的项目根目录路径' },
        idleMinutes: { type: 'number', description: '空闲自动停机超时时间 (分钟)，默认 25 分钟，设为 0 表示常驻不停机' },
      },
    },
  },
  {
    name: 'codebuddy_stop_webui',
    description: '手动停止后台正在运行的 CodeBuddy WebUI 服务并立即回收系统资源',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'codebuddy_get_status',
    description: '获取 CodeBuddy WebUI 服务状态、当前端口、PID、访问链接及空闲自动停机倒计时',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'codebuddy_run',
    description: '通过 CodeBuddy 执行任务 (自动工程会话绑定 + 模型阶梯自愈 + 别名智能纠偏 + 突破300秒异步模式 + 并发防撞)',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '发送给模型的任务描述或 Prompt' },
        model: {
          type: 'string',
          description: '显式指定的模型 ID。支持别名自动纠偏 (如 "4.1" 或 "deepseek4.1" 自动映射至 "deepseek-v4.1-flash"；"hy4" 自动映射至 "hy4-preview-f"；若用户提到 4.1 严禁自行替换为 pro)。缺省时自动按当前项目的模型阶梯首选运行',
        },
        cwd: { type: 'string', description: '执行工作区目录，默认为当前工程根目录' },
        session_id: { type: 'string', description: '指定会话 ID；缺省时自动使用当前工程专属的固定会话 ID' },
        new_session: { type: 'boolean', description: '是否为当前工程创建全新独立会话（重置历史上下文）' },
        timeout_seconds: { type: 'number', description: '最大执行超时时间 (秒)，默认 600 秒 (10 分钟)' },
        permission_mode: {
          type: 'string',
          description: '权限模式，默认 bypassPermissions (自动放行代码修改与单测，避免挂起阻塞)',
          enum: ['bypassPermissions', 'auto', 'acceptEdits', 'default'],
        },
        async: {
          type: 'boolean',
          description: '是否作为后台异步长任务执行。设为 true 时立即返回 taskId 与 waitCommand，彻底突破客户端超时限制；【严禁轮询】，请直接执行 waitCommand 挂起等待系统内核放行',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'codebuddy_task_status',
    description: '查询异步任务的最终执行成果或历史记录（仅在 waitCommand 完成后或排查时单次使用，【严禁】在任务运行中高频轮询）',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '需要查询的任务 ID；缺省时返回当前所有活跃或最近完成的任务' },
        cwd: { type: 'string', description: '可选，按工程根目录过滤任务' },
      },
    },
  },
  {
    name: 'codebuddy_set_model_ladder',
    description: '为当前工程设定模型执行阶梯 (首选/次选/兜底)，配置一次自动持久化记忆',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: '目标工程根目录，缺省为当前工程' },
        preset: {
          type: 'string',
          description: '预设套餐方案: A (深度攻坚型: DeepSeek-Pro -> 混元3.0 -> Flash), B (均衡主力型: 混元3.0 -> GLM-5.3 -> 3.0-X), C (极速响应型: DeepSeek-Flash -> GLM-Flash -> 混元3.0)',
          enum: ['A', 'B', 'C'],
        },
        ladder: {
          type: 'array',
          items: { type: 'string' },
          description: '自定义模型阶梯数组，按优先级顺序排列，如 ["deepseek-v4.1-flash", "hy3", "glm-5.3"]',
        },
      },
    },
  },
  {
    name: 'codebuddy_get_model_ladder',
    description: '查看当前工程当前生效的模型执行阶梯与可用预设方案',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: '目标工程根目录，缺省为当前工程' },
      },
    },
  },
  {
    name: 'codebuddy_list_sessions',
    description: '获取当前 CodeBuddy 中所有工程历史和活跃的会话列表',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: '过滤指定项目的会话；缺省或传入 * 查询全部项目' },
      },
    },
  },
  {
    name: 'codebuddy_list_models',
    description: '列出 CodeBuddy 支持的主流大模型列表及其能力说明',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// --- 处理 MCP 请求 ---
async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'codebuddy-bridge',
          version: '4.0.0',
        },
      },
    };
  }

  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      if (name === 'codebuddy_start_webui') {
        const res = await startWebUI(args || {});
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] },
        };
      }

      if (name === 'codebuddy_stop_webui') {
        const res = await stopWebUI();
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] },
        };
      }

      if (name === 'codebuddy_get_status') {
        const res = await getStatus();
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] },
        };
      }

      if (name === 'codebuddy_run') {
        const timeoutMs = typeof args.timeout_seconds === 'number' && args.timeout_seconds > 0
          ? args.timeout_seconds * 1000
          : 600000; // 默认 10 分钟

        if (args.async === true) {
          const res = await startAsyncTask(args, timeoutMs);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: res }] },
          };
        }

        const output = await runPrompt(
          args.prompt,
          args.model || null,
          args.cwd,
          args.session_id,
          args.new_session,
          timeoutMs,
          args.permission_mode || 'bypassPermissions'
        );
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: output }] },
        };
      }

      if (name === 'codebuddy_task_status') {
        const statusText = getTaskStatus(args?.task_id, args?.cwd);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: statusText }] },
        };
      }

      if (name === 'codebuddy_set_model_ladder') {
        touchActivity();
        const targetCwd = path.resolve(args?.cwd || process.cwd());
        let ladder = [];
        if (Array.isArray(args?.ladder) && args.ladder.length > 0) {
          ladder = args.ladder.map(m => normalizeModel(m) || m);
        } else if (args?.preset && MODEL_LADDER_PRESETS[args.preset]) {
          ladder = MODEL_LADDER_PRESETS[args.preset].ladder.map(m => normalizeModel(m) || m);
        } else {
          ladder = MODEL_LADDER_PRESETS[DEFAULT_PRESET].ladder.map(m => normalizeModel(m) || m);
        }
        const updated = setProjectConfig(targetCwd, { modelLadder: ladder });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `已为工程 [${path.basename(targetCwd)}] 成功设置并持久化模型阶梯梯队`,
                project: targetCwd,
                ladder,
              }, null, 2)
            }],
          },
        };
      }

      if (name === 'codebuddy_get_model_ladder') {
        touchActivity();
        const targetCwd = path.resolve(args?.cwd || process.cwd());
        const currentLadder = resolveProjectLadder(targetCwd);
        const pCfg = getProjectConfig(targetCwd);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                project: targetCwd,
                isConfigured: !!(pCfg && pCfg.modelLadder),
                currentLadder,
                primaryModel: currentLadder[0],
                secondaryModel: currentLadder[1] || null,
                fallbackModel: currentLadder[2] || null,
                availablePresets: MODEL_LADDER_PRESETS,
              }, null, 2)
            }],
          },
        };
      }

      if (name === 'codebuddy_list_sessions') {
        touchActivity();
        const isOnline = await checkApiOnline();
        if (!isOnline) {
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: 'WebUI 服务当前未运行。可通过 codebuddy_start_webui 启动。' }] },
          };
        }
        const filterCwd = args?.cwd || '*';
        const data = await apiRequest(`/api/v1/sessions?cwd=${encodeURIComponent(filterCwd)}`, 'GET');
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(data?.data || data, null, 2) }] },
        };
      }

      if (name === 'codebuddy_list_models') {
        const list = listModels();
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `未知的工具方法: ${name}` },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `执行错误: ${err.message}` }],
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `不支持的方法: ${method}` },
  };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const resp = await handleRequest(req);
    if (resp) {
      process.stdout.write(JSON.stringify(resp) + '\n');
    }
  } catch (err) {
    log(`解析 JSON-RPC 请求失败: ${err.message}, 内容: ${trimmed}`);
  }
});

log('CodeBuddy Bridge 4.1 (跨进程文件锁互斥 + 模型阶梯全类故障自愈 + 精确CORS + 长任务空闲保护 + 端口来源统一 + 跨平台进程树清理) 已就绪');
