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

module.exports = {
  getAntigravityMcpDir,
  getAntigravitySkillDir,
  getAntigravityAssetDir,
  checkAntigravityConfig,
};

