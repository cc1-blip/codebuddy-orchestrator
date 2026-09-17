#!/usr/bin/env node

const path = require('node:path');
const installer = require('../src/installer');
const logger = require('../src/logger');
const codexHost = require('../src/hosts/codex');
const antigravityHost = require('../src/hosts/antigravity');
const claudeHost = require('../src/hosts/claude');

const args = process.argv.slice(2);
const command = args[0] || 'doctor';

function showHelp() {
  console.log(`
CodeBuddy Orchestrator · 双 Agent 异构协同运维 CLI

用法:
  codebuddy-orchestrator <command> [options]

命令:
  doctor           检查本地运行环境、CodeBuddy CLI、登录态及各 AI 宿主状态 (默认)
  install          一键自动安装 CodeBuddy CLI (@tencent-ai/codebuddy-code)
  login            唤起 CodeBuddy CLI 登录向导 (微信/企微扫码或网页授权)
  init [--apply]   生成或自动写入 Codex / Claude 的 MCP 配置文件 (加 --apply 自动安装 CLI 并写入)
  logs [-f] [-n]   命令行直看实时输出流 (避免黑盒，支持 -f 追踪，-n 指定行数)
  status           查看当前运行中及最近完成的后台长任务状态看板
  help             显示本帮助信息

示例:
  npx codebuddy-orchestrator doctor
  npx codebuddy-orchestrator install
  npx codebuddy-orchestrator init --apply
  npx codebuddy-orchestrator logs -f
  npx codebuddy-orchestrator status
`);
}

switch (command) {
  case 'doctor':
    installer.runDoctor();
    break;

  case 'install':
    installer.installCodeBuddyCli();
    break;

  case 'login':
    installer.triggerLogin();
    break;

  case 'logs': {
    const follow = args.includes('-f') || args.includes('--follow');
    let lines = 30;
    const nIndex = args.findIndex((a) => a === '-n' || a === '--tail');
    if (nIndex !== -1 && args[nIndex + 1]) {
      lines = parseInt(args[nIndex + 1], 10) || 30;
    }
    logger.showLogs({ follow, lines });
    break;
  }

  case 'status':
    logger.showStatus();
    break;

  case 'init': {
    const apply = args.includes('--apply');
    const serverPath = path.resolve(__dirname, '..', 'src', 'server.cjs');
    console.log(`[Init] 准备为各宿主配置 CodeBuddy MCP 服务 (server: ${serverPath})`);

    const codexSnippet = codexHost.generateCodexTomlSnippet(serverPath);
    console.log('\n--- [OpenAI Codex] 配置片段 (~/.codex/config.toml) ---');
    console.log(codexSnippet);

    const claudeEntry = claudeHost.generateClaudeConfigEntry(serverPath);
    console.log('--- [Anthropic Claude Desktop] 配置片段 (claude_desktop_config.json) ---');
    console.log(JSON.stringify({ mcpServers: { codebuddy: claudeEntry } }, null, 2));

    if (apply) {
      const cliInfo = installer.resolveCodeBuddyInfo();
      if (!cliInfo.installed) {
        console.log('[Apply] 未检测到 CodeBuddy CLI，正在为您自动安装...');
        const installRes = installer.installCodeBuddyCli();
        if (!installRes.success) {
          console.warn('[Apply] ⚠️ CodeBuddy CLI 自动安装未成功，您可以稍后执行: npx codebuddy-orchestrator install');
        }
      }

      console.log('\n[Apply] 正在自动安全写入配置 (带 .bak 备份)...');
      const codexRes = codexHost.applyCodexConfig(serverPath);
      console.log(`- Codex: ${codexRes.message}`);
      const antigravityRes = antigravityHost.applyAntigravityConfig(serverPath);
      console.log(`- Antigravity: ${antigravityRes.message}`);
      const claudeRes = claudeHost.applyClaudeConfig(serverPath);
      console.log(`- Claude: ${claudeRes.message}`);
    } else {
      console.log('\n👉 提示: 运行 `npx codebuddy-orchestrator init --apply` 可自动检测/安装 CLI 并写入上述配置。');
    }
    break;
  }

  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;

  default:
    console.log(`未知命令: ${command}`);
    showHelp();
    process.exit(1);
}
