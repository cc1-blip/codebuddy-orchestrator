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

## 💡 缘起：一个由“薅羊毛”引发的协同革命

### 1. 初衷：明明有充足的免费算力，为什么用起来这么累？
腾讯云 CodeBuddy 搭载了国内极具性价比的大模型矩阵（**DeepSeek-V4.1-Flash / Pro、混元 3.0/4.0、智谱 GLM**），每天赠送大量算力额度，响应极快、上下文容量巨大，简直是开发者的“算力粮仓”。

但开发者很快遇到了两个极其痛苦的痛点：

- **痛点 A：缺乏顶层全局视野，人类审查累到吐血**  
  国产大模型写代码、改文件、刷单测能力极其剽悍，但面对超大型工程的架构一致性、边界契约、安全隔离时，常常需要人类坐在屏幕前肉眼审查成百上千行 diff，甚至还要人工一遍遍去协调跑测试，**“薅羊毛省下的 Token 钱，全拿去给人类看病了”**。
- **痛点 B：想让顶级大模型（Codex/Claude）当监理，却遭遇“协调两难”**  
  让 OpenAI Codex 或 Claude 扮演架构师来给 CodeBuddy 派活，本该是最完美的组合。但在真实工程里，瞬间撞上三堵南墙：
  1. **MCP 300 秒硬超时**：大模块重构动辄要跑 30~90 分钟，普通 MCP 超过 5 分钟直接掐断连接；
  2. **假挂起与 1300 万 Token 轮询惨案**：Codex 发现任务在后台跑，就自作聪明地用 15 秒定时器高频拉取状态。任务还在跑，Codex 昂贵的云端上下文已经轮询了几百次，**一觉醒来白白烧掉了 1300 万 Token 的昂贵美金，羊毛没薅到反被倒薅一把！**
  3. **429 限流半途而废**：任务跑了 40 分钟，突然模型触发限流或欠费，没有自愈机制，整个会话断裂前功尽弃。

---

### 2. 破局：架构师负责把关，工人负责流汗，内核负责放哨！

本项目（`CodeBuddy Orchestrator`）正是为了终结上述痛点而生：

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

---

## 🌟 四大核心黑科技

### 1. ⚡ 操作系统内核原生阻塞 (Zero-Polling Kernel Wait)
- 异步长任务启动后，调度器回传子进程 `PID` 与专属内核等待指令：
  - **Windows**: `powershell -ExecutionPolicy Bypass -File wait-job.ps1 -ProcessId <pid>` 或原生 `Wait-Process -Id <pid>`；
  - **macOS / Linux**: `bash wait-job.sh --process-id <pid>`；
- **核心价值**：在长达几十分钟的执行期内，总控端处于系统原生阻塞状态，**CPU 占用接近 0，Token 消耗绝对为 0**！子进程退出的那一毫秒，Windows/POSIX 内核瞬间放行，立即唤醒总控。

### 2. 🔄 生产级模型阶梯故障自愈 (Model Ladder & Failover)
- 预设梯队：主力 `DeepSeek-V4.1-Flash` → 次选 `混元 4 Preview` → 强力 `DeepSeek-V4-Pro` → 兜底 `智谱 GLM`；
- 当遇到 **429 频控、额度欠费、执行超时或网络抖动** 时，调度器**在同一工程会话内无缝切换次级模型接盘**，历史记忆不丢，杜绝长任务半途夭折。

### 3. 🚀 突破 MCP 客户端 300 秒硬超时
- 通过后台解耦生成唯一任务 ID，突破客户端 300s 限制。
- 哪怕是持续 **75 分钟、279 轮链式交互、处理 1.2 亿 Token** 的重型纵向切片任务，也能一次性稳定交付。

### 4. 🔒 权限全自动放行 + 会话级并发互斥锁
- 底层注入 `-y` 与 `--permission-mode bypassPermissions`，所有新建文件与单测自动放行，绝不交互卡死；
- 若多 Agent 并行开发，同工程不同 `session_id` 安全并行，同 `session_id` 自动排队，防止上下文踩踏。

---

## 🚀 极速上手 (Quick Start)

### 步骤 1：一键体检与环境自检
无需安装依赖，直接在终端执行：
```bash
npx codebuddy-orchestrator doctor
```
系统会自动检测 Node.js (>=18)、PowerShell 脚本策略、CodeBuddy CLI 版本、大模型凭据与本地 AI 宿主。

### 步骤 2：一键配置生成 / 自动写入
```bash
# 查看配置代码预览 (Dry-Run)
npx codebuddy-orchestrator init

# 自动写入各宿主配置 (带自动 .bak 备份，绝不静默覆盖)
npx codebuddy-orchestrator init --apply
```

---

## 🔌 多宿主配置参考

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
插件包内附带了开箱即用的 `skills/codebuddy-orchestrator/SKILL.md`，直接激活即可调用。

---

## 🎯 三大实战提示词模版 (Prompt Guide)

### 模式 A：极速微调与小 Bug 修复 (同步直通 · < 3 分钟)
> **对 Codex / Claude 说**：
```markdown
请让 CodeBuddy 用 4.1 在当前工程修复 [具体文件/问题]。权限全放行，完成后给出简要说明与测试结果。
```

### 模式 B：重型功能纵向切片实施 (异步深度实施 · 10 ~ 90 分钟)
> **对 Codex / Claude 说**：
```markdown
实施当前唯一任务 [任务编号]。你是总控架构师，请严格按 AGENTS.md 派发任务给 CodeBuddy：
- 严格限制在 Allowed paths 范围内修改；
- CodeBuddy 只负责编码与自测，不得自审、不得自标 accepted；
- 跑完定向测试后以规范的 ready_for_review 结构交付；
- 收到交付后，由你进行独立代码审查与全量门禁验证。
```

### 模式 C：独立只读审查 (Code Review · 0 污染)
> **架构师验收时自动执行**：
```markdown
对任务 [任务编号] 进行独立只读审查，严格核对契约，不写业务代码，只输出 Critical/High/Medium/Low 问题清单。
```

---

## 📊 真实战报：它到底有多能打？

以下是在真实复杂开源游戏工程中完成 **`DS-P3-014`（桌面 PvP 纵向闭环）** 任务的真实生产数据：

| 指标 | 实测表现 | 说明 |
| :--- | :--- | :--- |
| **实际持续耗时** | **75 分 25 秒 (4525.2s)** | 突破任何 MCP 客户端限制，单次任务平稳闭环 |
| **链式交互轮数** | **279 轮连续交互** | 完成 7 个核心模块、7 大类测试套件的编写与调试 |
| **Token 吞吐量** | **122,751,156 Tokens (1.22亿)** | 充分释放国内模型吞吐能力 |
| **Prompt 缓存命中率** | **99.6%** | 极速响应，几乎全中本地上下文缓存 |
| **中途轮询消耗** | **0 Token · 0 次多余调用** | `Wait-Process` 内核等待静默守护，一分钱没浪费 |
| **审查闭环** | **自动修复历史遗留缺陷** | 架构师挑出并发边缘 case，工人再次唤醒 55 分钟完成二次收敛 |

---

## 📂 目录结构

```text
codebuddy-orchestrator/
├── package.json                 # npm 发包规范（支持 npx 运行）
├── README.md                    # 本文档
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

## 📄 License

本项目采用 [MIT License](LICENSE)。欢迎自由使用、魔改与分发，一起优雅地薅羊毛，把 AI 生产力发挥到极致！
