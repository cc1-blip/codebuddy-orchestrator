const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getAntigravityMcpDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'mcp', 'codebuddy');
}

function getAntigravitySkillDir() {
  return path.join(os.homedir(), '.gemini', 'config', 'plugins', 'codebuddy-orchestrator', 'skills', 'codebuddy-orchestrator');
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
  };
}

module.exports = {
  getAntigravityMcpDir,
  getAntigravitySkillDir,
  checkAntigravityConfig,
};
