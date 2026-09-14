const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const codexHost = require('./hosts/codex');
const antigravityHost = require('./hosts/antigravity');
const claudeHost = require('./hosts/claude');

function checkEnvironment() {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  const isNodeValid = major >= 18;

  let powershellPolicy = 'N/A';
  if (process.platform === 'win32') {
    try {
      powershellPolicy = execSync('powershell -Command "Get-ExecutionPolicy"', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      powershellPolicy = 'Unknown';
    }
  }

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion,
    isNodeValid,
    powershellPolicy,
  };
}

function resolveCodeBuddyInfo() {
  const candidates = [
    'D:\\agentmesh-tools\\codebuddy\\codebuddy.cmd',
    path.join(os.homedir(), '.agentmesh-tools', 'codebuddy', 'codebuddy.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codebuddy.cmd'),
    '/usr/local/bin/codebuddy',
    '/opt/homebrew/bin/codebuddy',
  ];

  let resolvedPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      resolvedPath = c;
      break;
    }
  }

  if (!resolvedPath) {
    try {
      const cmd = process.platform === 'win32' ? 'where.exe codebuddy' : 'which codebuddy';
      const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/[\r\n]+/)[0].trim();
      if (out && fs.existsSync(out)) resolvedPath = out;
    } catch {}
  }

  let version = null;
  let isAvailable = false;
  if (resolvedPath) {
    try {
      const out = execSync(`"${resolvedPath}" --version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
        .toString()
        .trim();
      version = out;
      isAvailable = true;
    } catch {}
  }

  return {
    installed: isAvailable,
    path: resolvedPath,
    version,
    isVersionSufficient: version ? compareVersion(version, '2.140.0') >= 0 : false,
  };
}

function compareVersion(v1, v2) {
  const clean1 = (v1.match(/\d+(\.\d+)+/) || ['0.0.0'])[0];
  const clean2 = (v2.match(/\d+(\.\d+)+/) || ['0.0.0'])[0];
  const parts1 = clean1.split('.').map(Number);
  const parts2 = clean2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

function installCodeBuddyCli() {
  console.log('[Installer] 正在使用腾讯云镜像安装 CodeBuddy CLI (@tencent-ai/codebuddy-code)...');
  try {
    execSync('npm install -g @tencent-ai/codebuddy-code --registry=https://mirrors.cloud.tencent.com/npm/', {
      stdio: 'inherit',
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function checkAuthStatus() {
  const info = resolveCodeBuddyInfo();
  if (!info.installed) return { authed: false, reason: 'CLI not installed' };

  try {
    const testOut = execSync(`"${info.path}" -p "ping" --model deepseek-v4.1-flash -y`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).toString().trim();
    const isAuthed = !/(?:401|unauthorized|未登录|请先登录|login)/i.test(testOut);
    return { authed: isAuthed, detail: testOut.slice(0, 100) };
  } catch (e) {
    return { authed: true, detail: 'Assumed valid (non-blocking)' };
  }
}

function triggerLogin() {
  const info = resolveCodeBuddyInfo();
  if (!info.installed) {
    console.error('[Auth] 无法唤起登录：CodeBuddy CLI 尚未安装。请先安装 CLI。');
    return;
  }
  console.log('[Auth] 正在唤起 CodeBuddy 登录向导...');
  spawn(info.path, ['login'], { stdio: 'inherit', shell: true });
}

function runDoctor() {
  const env = checkEnvironment();
  const cli = resolveCodeBuddyInfo();
  const serverPath = path.resolve(__dirname, 'server.cjs');

  const codex = codexHost.checkCodexConfig(serverPath);
  const antigravity = antigravityHost.checkAntigravityConfig();
  const claude = claudeHost.checkClaudeConfig(serverPath);

  console.log('===============================================================');
  console.log('     🤖 CodeBuddy Orchestrator · 环境与多宿主健康自检报告       ');
  console.log('===============================================================');
  console.log(`[运行环境] Node: ${env.nodeVersion} (${env.isNodeValid ? '✅ 符合要求' : '❌ 需 >= 18.0.0'}), 平台: ${env.platform}`);
  if (process.platform === 'win32') {
    console.log(`[系统策略] PowerShell ExecutionPolicy: ${env.powershellPolicy} (已内置 -ExecutionPolicy Bypass 保护)`);
  }

  console.log('---------------------------------------------------------------');
  if (cli.installed) {
    console.log(`[CodeBuddy CLI] ✅ 已安装 (版本: ${cli.version})`);
    console.log(`                路径: ${cli.path}`);
  } else {
    console.log(`[CodeBuddy CLI] ❌ 未检测到 CLI。请运行: npm install -g @tencent-ai/codebuddy-code`);
  }

  console.log('---------------------------------------------------------------');
  console.log('[宿主支持情况]');
  console.log(`- OpenAI Codex:         ${codex.installed ? (codex.configured ? '✅ 已配置' : '⚪ 已安装但待配置') : '未检测到目录'}`);
  console.log(`- Google Antigravity:   ${antigravity.installed ? (antigravity.mcpConfigured ? '✅ 已挂载' : '⚪ 已安装') : '未检测到目录'}`);
  console.log(`- Anthropic Claude:     ${claude.installed ? (claude.configured ? '✅ 已配置' : '⚪ 已安装但待配置') : '未检测到目录'}`);

  console.log('===============================================================');
  return { env, cli, codex, antigravity, claude };
}

module.exports = {
  checkEnvironment,
  resolveCodeBuddyInfo,
  installCodeBuddyCli,
  checkAuthStatus,
  triggerLogin,
  runDoctor,
};
