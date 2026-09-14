#!/usr/bin/env node

const path = require('node:path');
const installer = require('../src/installer');
const codexHost = require('../src/hosts/codex');
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
  login            唤起 CodeBuddy CLI 登录向导 (微信/企微扫码或网页授权)
  init [--apply]   生成或自动写入 Codex / Claude 的 MCP 配置文件
  help             显示本帮助信息

示例:
  npx codebuddy-orchestrator doctor
  npx codebuddy-orchestrator init --apply
`);
}

switch (command) {
  case 'doctor':
    installer.runDoctor();
    break;

  case 'login':
    installer.triggerLogin();
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
      console.log('\n[Apply] 正在自动安全写入配置 (带 .bak 备份)...');
      const codexRes = codexHost.applyCodexConfig(serverPath);
      console.log(`- Codex: ${codexRes.message}`);
      const claudeRes = claudeHost.applyClaudeConfig(serverPath);
      console.log(`- Claude: ${claudeRes.message}`);
    } else {
      console.log('\n👉 提示: 运行 `npx codebuddy-orchestrator init --apply` 可自动写入上述配置。');
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
