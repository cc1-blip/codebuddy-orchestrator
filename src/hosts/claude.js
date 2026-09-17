const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getClaudeDesktopConfigPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else {
    return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
}

function generateClaudeConfigEntry(serverPath) {
  return {
    command: 'node',
    args: [serverPath],
  };
}

function checkClaudeConfig(serverPath) {
  const configPath = getClaudeDesktopConfigPath();
  const dirExists = fs.existsSync(path.dirname(configPath));
  const fileExists = fs.existsSync(configPath);
  let configured = false;

  if (fileExists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      configured = !!(parsed.mcpServers && parsed.mcpServers.codebuddy);
    } catch {}
  }

  return {
    installed: dirExists || fileExists,
    configured,
    configPath,
    entry: generateClaudeConfigEntry(serverPath),
  };
}

function applyClaudeConfig(serverPath) {
  const configPath = getClaudeDesktopConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      fs.writeFileSync(`${configPath}.bak-${Date.now()}`, JSON.stringify(config, null, 2), 'utf8');
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.codebuddy = generateClaudeConfigEntry(serverPath);

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return { status: 'applied', message: `Successfully registered codebuddy MCP into ${configPath}` };
}

module.exports = {
  getClaudeDesktopConfigPath,
  generateClaudeConfigEntry,
  checkClaudeConfig,
  applyClaudeConfig,
};
