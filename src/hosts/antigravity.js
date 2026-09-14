const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getAntigravityMcpDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'mcp', 'codebuddy');
}

function getAntigravitySkillDir() {
  return path.join(os.homedir(), '.gemini', 'config', 'plugins', 'codebuddy-orchestrator', 'skills', 'codebuddy-orchestrator');
}

function getAntigravityAssetDir() {
  return path.join(os.homedir(), '.gemini', 'config', 'plugins', 'codebuddy-orchestrator', 'assets');
}

function checkAntigravityConfig() {
  const mcpDir = getAntigravityMcpDir();
  const installed = fs.existsSync(path.join(os.homedir(), '.gemini', 'antigravity'));
  const mcpConfigured = fs.existsSync(path.join(mcpDir, 'codebuddy_run.json'));
  return {
    installed,
    mcpConfigured,
    mcpDir,
    skillDir: getAntigravitySkillDir(),
    assetDir: getAntigravityAssetDir(),
  };
}

function applyAntigravityConfig(serverPath) {
  const geminiDir = path.join(os.homedir(), '.gemini');
  if (!fs.existsSync(geminiDir)) {
    return { status: 'skipped', message: '未检测到 Google Antigravity 环境目录 (~/.gemini)，已跳过。' };
  }

  const pluginDir = path.join(geminiDir, 'config', 'plugins', 'codebuddy-orchestrator');
  const skillDir = path.join(pluginDir, 'skills', 'codebuddy-orchestrator');
  const assetDir = path.join(pluginDir, 'assets');
  const mcpDir = getAntigravityMcpDir();

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(assetDir, { recursive: true });
    fs.mkdirSync(mcpDir, { recursive: true });

    // 1. plugin.json
    const pluginJson = {
      name: 'codebuddy-orchestrator',
      version: '1.0.0',
      description: 'CodeBuddy Orchestrator Dual-Agent bridge for Google Antigravity via MCP',
      license: 'MIT',
    };
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2), 'utf8');

    // 2. mcp_config.json
    const normalizedPath = serverPath.replace(/\\/g, '/');
    const mcpConfig = {
      mcpServers: {
        codebuddy: {
          command: 'node',
          args: [normalizedPath],
        },
      },
    };
    fs.writeFileSync(path.join(pluginDir, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2), 'utf8');

    // 3. Copy SKILL.md
    const sourceSkill = path.resolve(__dirname, '..', '..', 'skills', 'codebuddy-orchestrator', 'SKILL.md');
    if (fs.existsSync(sourceSkill)) {
      fs.copyFileSync(sourceSkill, path.join(skillDir, 'SKILL.md'));
    }

    // 4. Copy asset
    const sourceMonitor = path.resolve(__dirname, '..', '..', 'assets', 'codebuddy_monitor.html');
    if (fs.existsSync(sourceMonitor)) {
      fs.copyFileSync(sourceMonitor, path.join(assetDir, 'codebuddy_monitor.html'));
    }

    // 5. Copy MCP schemas
    const sourceMcp = path.resolve(__dirname, '..', '..', 'mcp');
    if (fs.existsSync(sourceMcp)) {
      const files = fs.readdirSync(sourceMcp);
      for (const f of files) {
        if (f.endsWith('.json')) {
          fs.copyFileSync(path.join(sourceMcp, f), path.join(mcpDir, f));
        }
      }
    }

    return {
      status: 'applied',
      message: `已成功为 Google Antigravity 挂载 MCP 工具集与专属技能 (${pluginDir})`,
    };
  } catch (err) {
    return {
      status: 'error',
      message: `配置 Google Antigravity 失败: ${err.message}`,
    };
  }
}

module.exports = {
  getAntigravityMcpDir,
  getAntigravitySkillDir,
  getAntigravityAssetDir,
  checkAntigravityConfig,
  applyAntigravityConfig,
};

