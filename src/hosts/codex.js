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
  if (content.includes('[mcp_servers.codebuddy]')) {
    return { status: 'already_configured', message: 'Codex config already contains codebuddy MCP server entry.' };
  }

  // Create backup
  if (fs.existsSync(configPath)) {
    fs.writeFileSync(`${configPath}.bak-${Date.now()}`, content, 'utf8');
  }

  const snippet = generateCodexTomlSnippet(serverPath);
  fs.appendFileSync(configPath, snippet, 'utf8');
  return { status: 'applied', message: `Successfully registered codebuddy MCP into ${configPath}` };
}

module.exports = {
  getCodexConfigPath,
  generateCodexTomlSnippet,
  checkCodexConfig,
  applyCodexConfig,
};
