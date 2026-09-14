# 🤖 CodeBuddy Orchestrator

<div align="center">

### 双 Agent 异构协同中枢 · 如何优雅地“薅大模型算力”

**让顶级大脑（OpenAI Codex / Claude / 无重力）当严格包工头，让国产大模型（DeepSeek 4.1 / 混元 4）当重型苦力**  
*基于操作系统内核级等待，彻底消灭轮询消耗，实现 0 Token 浪费的全自动开发与审查闭环。*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-MCP%20(Model%20Context%20Protocol)-blue.svg)](https://modelcontextprotocol.io/)
[![Zero Polling](https://img.shields.io/badge/Zero--Polling-Native%20OS%20Kernel%20Wait-success.svg)](#)

</div>

---

## 💡 为什么做这个？（我的真实初衷）

老实说，我做这个工具的初衷特别简单：**就是想狠狠薅腾讯 CodeBuddy 的羊毛**。

腾讯给的免费算力（**DeepSeek-V4.1-Flash、混元 4、智谱 GLM**）额度又大又香，不用白不用。但实际在项目里用起来，我发现两个地方特别难受：

1. **自己审查协调太累**：CodeBuddy 搬砖速度极快，噼里啪啦改了一大堆文件，但我得肉眼一行行去看几千行 diff、还得手动帮它跑测试。每次协调起来繁琐得要命，薅羊毛省下的钱，全拿去给自己看眼睛了。
2. **让 Codex / Claude 帮我把关，结果差点被倒薅一把**：
   - **超时断连**：复杂任务跑个十几分钟，MCP 客户端 300 秒就直接超时掐断；
   - **恶心人的假挂起**：Codex 表面上说在等，背地里却用 15 秒定时器拼命轮询后台状态。任务还在跑，Codex 昂贵的云端 Token 已经空转了几百次，**一觉醒来偷偷烧了我 1300 万 Token（肉疼死了！）**；
   - **429 崩溃**：跑了半个多小时一旦遇到频控或欠费，没有自动重试，整场任务直接报废。

### 于是我做了这套协同方案：
- **大脑归大脑**：让 OpenAI Codex / Claude 当严格包工头，只负责发任务和独立跑门禁，一行业务代码都不用我肉眼看；
- **算力归算力**：让 CodeBuddy 当重型苦力疯狂码代码、补单测；
- **内核来放哨**：用操作系统原生的 `Wait-Process` 挂起，**任务跑两小时，中间也是纯纯的 0 Token 消耗，不花一分冤枉钱！**
- **战报清清楚楚**：**每跑完一轮，你都能直接看到一张详尽的消耗战报**（实际耗时、缓存命中率、Token 吞吐量、消耗点数），明明白白知道自己这次又薅了多少羊毛！

---

## 🚀 极速上手 (Quick Start)

### 步骤 1：一键体检与环境自检
无需安装依赖，直接在终端执行：
```bash
npx codebuddy-orchestrator doctor
```
系统会自动检测 Node.js (>=18)、PowerShell 脚本策略、CodeBuddy CLI 版本、大模型凭据与本地 AI 宿主。

### 步骤 2：一键配置生成 / 自动写入
无需安装依赖，直接在终端执行：
```bash
# 查看配置代码预览 (Dry-Run)
npx codebuddy-orchestrator init

# 自动写入各宿主配置 (带自动 .bak 备份，绝不静默覆盖)
npx codebuddy-orchestrator init --apply
```

---

## 📺 不想开 WebUI？纯命令行实时监控（彻底告别黑盒）

很多人问：“我不习惯开浏览器 WebUI，能不能只在命令行看 CodeBuddy 跑代码？后台静默跑着总觉得像黑盒不知道它在干嘛。”

**答案是：完全可以，而且这才是最爽的极客姿势！**

### 1. 终端实时看代码瀑布流（0 Token 消耗，绝不污染主模型）
只需在旁边开一个终端窗口：
```bash
# 全局极速命令：实时追踪 CodeBuddy 命令行输出
npx codebuddy-orchestrator logs -f

# 或者直接用 Windows 原生 PowerShell：
Get-Content -Wait -Tail 30 "bridge.log"
```
👉 **效果**：CodeBuddy 当前在读哪个文件、搜了什么代码、改了哪几行、运行了什么单测，全部实时在终端跳动，毫秒级透明，完全不需要开浏览器！

### 2. 随时查看任务执行状态与历史
```bash
npx codebuddy-orchestrator status
```
一眼看到当前有几个后台长任务在跑、已经跑了多少秒、当前最新动作是什么。

### 3. 主终端动态心跳（告别死等假死感）
自带的 `wait-job.ps1` 内置了进度心跳摘要，主窗口在等待时会自动吐出 `[WAIT-JOB +25s] 正在阅读 xxx.ts`，既告别了假死黑盒感，又绝对不会用上万行原始日志撑爆主模型的上下文！

---

## 📊 结束一轮后看到的透明消耗看板（直观看到薅了多少）

无论是轻量修改还是跑了几十分钟的超大闭环，CodeBuddy 每次跑完都会在末尾输出这样一张透明战报：

```markdown
────────────────────────────────────────────────────
📊 CodeBuddy 执行消耗与性能统计
* 生效模型：deepseek-v4.1-flash
* 实际耗时：75 分 25 秒 (4525.2s) (共完成 279 轮链式交互)
* 缓存命中输入 (Cache Hit)：122,023,552 tokens (🔥 命中率 99.6%) 
* 新计算输入 (Cache Miss)：489,662 tokens
* 生成输出 (Output)：237,942 tokens (含深度思考 97,174 tokens)
* 总交互量 (Total)：122,751,156 tokens (1.22 亿)
* 算力消耗 (Credit)：62.97 点
────────────────────────────────────────────────────
```
> **实测数据**：上面是我在真实开源工程里完成 `DS-P3-014`（桌面 PvP 纵向闭环）的真实战报，一口气跑了 75 分钟、279 轮交互、吞吐了 1.2 亿 Token，而作为包工头的 Codex 中途 0 轮询，整个过程极其省心。

---

## ⚡ 怎么做到的？核心机制大白话

```text
[ 开发者只需下达一句话业务目标 ]
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│           🧠 总控架构师与独立审查者 (Lead Architect)          │
│                OpenAI Codex / Google Antigravity             │
│  · 需求拆解与契约把控  · 划分 Allowed paths  · 独立复测验收   │
└──────────────────────────────┬───────────────────────────────┘
                               │ 派发重型实施 (codebuddy_run, async=true)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│               ⚡ CodeBuddy Orchestrator (调度引擎)            │
│  · 别名纠偏  · 模型自愈阶梯  · 会话防撞锁  · 超时突破        │
└──────────────┬───────────────────────────────────────────────┘
               │                                   ▲
               │ 启动本地子进程 (带 PID)             │ 毫秒级放行
               ▼                                   │ (0 Token 消耗)
┌──────────────────────────────┐       ┌───────────────────────┐
│     👷 重型实施工人 (Worker)  │       │  ⏱️ 操作系统原生内核等待│
│    CodeBuddy / DeepSeek 4.1  │──────>│  Windows: Wait-Process│
│  · 疯狂写代码、补全量单测    │ 进程退出│  macOS: kill -0 信号  │
│  · 75分钟链式交互，沉浸交付   │       │  (期间 0 轮询、0 报错) │
└──────────────────────────────┘       └───────────────────────┘
                                                   │
                                                   ▼ 唤醒架构师
┌──────────────────────────────────────────────────────────────┐
│           🔍 自动化独立审查循环 (Independent Review)          │
│  · 架构师独立运行全量门禁                                     │
│  · 发现细节问题 ──(自动触发 changes_requested)──> 唤醒工人复修 │
│  · 全部门禁通过 ──(判定 accepted)───────────────> 交付人类开发者│
└──────────────────────────────────────────────────────────────┘
```

1. **操作系统内核原生等待（彻底消灭轮询）**：
   任务派发出去后，系统直接拿着子进程的 `PID` 丢给操作系统的 `Wait-Process`（或 POSIX `kill -0`）。在后台进程跑完前，调用端完全处于系统级静默等待，**CPU 和 Token 消耗都是绝对的 0**，进程一退出的毫秒间立即唤醒总控。
2. **模型阶梯自愈接力（Model Ladder）**：
   我配置了模型梯队（`DeepSeek 4.1` → `混元 4 Preview` → `DeepSeek Pro` → `智谱 GLM`）。中途要是哪天遇到 429 频控或者欠费，调度器**在同一个会话里秒切备选模型接盘**，几十分钟的成果绝对不会泡汤。
3. **突破 300 秒硬超时**：
   通过后台解耦长任务，彻底把 MCP 客户端的 300 秒死线变成历史，想跑 1 个小时还是 2 个小时随你便。
4. **全自动放行与防踩踏**：
   底层固定注入 `-y` 和 `--permission-mode bypassPermissions`，改代码、跑单测全自动放行，绝不弹窗卡死；同时同一项目自动加上会话文件锁，防止多个 Agent 把工作区改炸。

---

## 🔌 宿主配置参考（按需粘贴）

### A. OpenAI Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.codebuddy]
command = "node"
args = ["C:/Users/cz/plugins/codebuddy-orchestrator/src/server.cjs"]
enabled = true
default_tools_approval_mode = "approve"
startup_timeout_sec = 10
tool_timeout_sec = 1200
```

### B. Anthropic Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "codebuddy": {
      "command": "node",
      "args": ["C:/Users/cz/plugins/codebuddy-orchestrator/src/server.cjs"]
    }
  }
}
```

### C. Google Antigravity (无重力)
插件包内已附带 `skills/codebuddy-orchestrator/SKILL.md`，直接在工具或技能面板中启用即可。

---

## 🎯 我平时常用的 3 套提示词模版 (Prompt Guide)

### 模式 A：极速改个小 Bug (同步直通 · < 3 分钟)
> **对 Codex / Claude 说**：
```markdown
请让 CodeBuddy 用 4.1 在当前工程修复 [具体文件/报错]。权限全放行，完成后给出简要说明与测试结果。
```

### 模式 B：让它独立实施大功能 (异步深度开发 · 10 ~ 90 分钟)
> **对 Codex / Claude 说**：
```markdown
实施当前任务 [任务编号]。你是总控架构师，请严格按规范派发任务给 CodeBuddy：
- 严格限制在 Allowed paths 范围内修改；
- CodeBuddy 只负责编码与自测，不得自审、不得自标 accepted；
- 跑完定向测试后以规范的 ready_for_review 交付；
- 收到交付后，由你进行独立代码审查与全量门禁验证。
```

### 模式 C：架构师只读把关 (Code Review · 0 脏代码)
> **架构师验收时自动执行**：
```markdown
对任务 [任务编号] 进行独立只读审查，严格核对契约，不写业务代码，只输出 Critical/High/Medium/Low 问题清单。
```

---

## 📂 仓库目录结构

```text
codebuddy-orchestrator/
├── package.json                 # npm 发包规范（支持 npx 运行）
├── README.md                    # 本说明文档
├── bin/
│   └── cli.js                   # 终端运维 CLI (doctor, init, login, help)
├── src/
│   ├── server.cjs               # 生产级 MCP 核心调度引擎 (自愈接力、会话锁、超时突破)
│   ├── installer.js             # 环境巡检、CLI 自动安装/升级、登录探测核心
│   └── hosts/                   # 跨平台宿主适配器 (带 .bak 自动备份)
│       ├── codex.js             # OpenAI Codex 适配器
│       ├── antigravity.js       # Google Antigravity 适配器
│       └── claude.js            # Anthropic Claude Desktop 适配器
├── scripts/
│   ├── wait-job.ps1             # Windows 内核级等待脚本 (内置 -ExecutionPolicy Bypass)
│   └── wait-job.sh              # macOS / Linux 内核级等待脚本 (POSIX 原生信号阻塞)
├── skills/
│   └── codebuddy-orchestrator/
│       └── SKILL.md             # 面向 AI Agent 的标准能力与协同准则
└── templates/
    ├── AGENTS.md                # 架构师-工人协作规则模板 (Section 5 反轮询准则)
    └── PROMPT_GUIDE.md          # 3 大实战场景即拷即用提示词模版
```

---

## 📄 开源协议
本项目采用 [MIT License](LICENSE)。欢迎尽情薅羊毛，把 AI 生产力发挥到极致！
