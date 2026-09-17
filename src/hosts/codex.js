const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getCodexConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function generateCodexTomlSnippet(serverPath) {
  const normalizedPath = serverPath.replace(/\\/g, '/');
  return `
[mcp_servers.codebuddy]
command = "node"
args = ["${normalizedPath}"]
enabled = true
default_tools_approval_mode = "approve"
startup_timeout_sec = 10
tool_timeout_sec = 1200
`;
}

function checkCodexConfig(serverPath) {
  const configPath = getCodexConfigPath();
  const exists = fs.existsSync(configPath);
  let configured = false;

  if (exists) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      configured = content.includes('[mcp_servers.codebuddy]');
    } catch {}
  }

  return {
    installed: exists,
    configured,
    configPath,
    snippet: generateCodexTomlSnippet(serverPath),
  };
}

function applyCodexConfig(serverPath) {
  const configPath = getCodexConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const normalizedPath = serverPath.replace(/\\/g, '/');

  // Create backup
  if (fs.existsSync(configPath)) {
    fs.writeFileSync(`${configPath}.bak-${Date.now()}`, content, 'utf8');
  }

  if (content.includes('[mcp_servers.codebuddy]')) {
    if (content.includes(`"${normalizedPath}"`)) {
      return { status: 'already_configured', message: 'Codex 配置已正确包含当前 CodeBuddy MCP 服务路径。' };
    }
    const newSnippet = generateCodexTomlSnippet(serverPath).trim();
    const updated = content.replace(/\[mcp_servers\.codebuddy\][\s\S]*?(?=\n\[|$)/, newSnippet + '\n\n');
    fs.writeFileSync(configPath, updated, 'utf8');
    return { status: 'updated', message: `Codex 已包含历史配置，已平滑自动更新路径至: ${serverPath}` };
  }

  const snippet = generateCodexTomlSnippet(serverPath);
  fs.appendFileSync(configPath, snippet, 'utf8');
  return { status: 'applied', message: `已成功将 CodeBuddy MCP 写入 Codex 配置文件: ${configPath}` };
}

module.exports = {
  getCodexConfigPath,
  generateCodexTomlSnippet,
  checkCodexConfig,
  applyCodexConfig,
};
