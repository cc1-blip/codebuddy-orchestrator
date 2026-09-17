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

### 步骤 1：一键环境自检 (Doctor)

无需发布 npm、无需提前下载，直接在终端执行：
```bash
# 方式 A（最推荐）：直接通过 GitHub 仓库免装运行
npx github:cc1-blip/codebuddy-orchestrator doctor

# 方式 B：本地克隆运行
git clone https://github.com/cc1-blip/codebuddy-orchestrator.git
cd codebuddy-orchestrator && node bin/cli.js doctor
```
系统会自动检测 Node.js (>=18)、PowerShell 脚本策略、CodeBuddy CLI 版本、腾讯账号登录态与本地 AI 宿主配置。

> 💡 **还没装 CodeBuddy CLI？**  
> 别担心！你可以随时运行 `npx github:cc1-blip/codebuddy-orchestrator install` 一键高速自动安装（内置腾讯云镜像加速）；  
> 或者直接进行下面的**步骤 2 (选项 A)**，系统在写入配置前若检测到缺少 CLI，会**全自动帮你安装**！

### 步骤 2：一键配置生成 / 自动写入 (Init)

> 💡 **这是二选一的**：如果你想一步到位直接搞定，**直接执行选项 A 即可**！

#### 选项 A（最推荐 · 一步到位）：自动安装 CLI 并写入宿主配置
自动检测并写入你电脑上的 Codex 或 Claude 配置（若未安装 CodeBuddy CLI 会自动一键安装，写入前强制自动生成带时间戳的 `.bak` 备份）：
```bash
npx github:cc1-blip/codebuddy-orchestrator init --apply
```

#### 选项 B（严谨预览 · 纯查看）：仅打印配置代码
如果你想先肉眼看一眼配置长什么样、或者打算手工粘贴：
```bash
npx github:cc1-blip/codebuddy-orchestrator init
```

---

## 📺 极致透明监控：对话流实时监考卡片 + 本地 SSE 流式广播（彻底告别黑盒）

很多人问：“后台长任务静默跑着总觉得像黑盒，能不能边跑边看代码和思考流动，同时还绝对不浪费主模型的 Token？”

**答案是：不仅可以，而且做到了业界天花板级的极客体验！**

核心黄金法则：**“代码与思考流必须在前端 UI / 终端上直接呈现给人类眼睛，但绝对不能计入主 AI 的上下文 Token 账单中！”**

### 1. 【无重力 (Antigravity)】对话流内嵌极客监考卡片 (Generative UI)
- 任务启动的第 1 秒，无重力聊天气泡里会自动点亮一个精致的 **深色极客监考控制台**（`<agent-embed>`）。
- **毫秒级代码打字机**：通过本地轻量 SSE（`http://127.0.0.1:18991/api/tasks/:id/stream`）直接向浏览器 DOM 推送，**主大模型 0 Token 消耗**！
- **输入输出全闭环**：顶部新增【📥 派发指令折叠抽屉】，一字不差复核宿主到底给它下了什么命令；
- **当前动作聚焦**：实时正则提炼底层状态（`🎯 正在检索 src/auth.ts`、`📝 正在编写 Diff`、`🧪 正在运行单测`）；
- **🛑 一键紧急刹车 (Kill Switch)**：发现模型走偏，直接点击终止按钮，瞬间终结底层进程并释放互斥锁，杜绝烧无谓额度！

### 2. 【Codex / 独立浏览器】本地 Web 监考端点
在任何浏览器或 VS Code 侧边栏打开：
```
http://127.0.0.1:18991/monitor?taskId=task-xxx
```
自动接入实时日志流与状态看板，多屏监控两不误！

### 3. 【纯终端姿势】实时看代码瀑布流与心跳
只需在旁边开一个终端窗口：
```bash
# 全局极速命令：实时追踪 CodeBuddy 命令行输出
npx codebuddy-orchestrator logs -f

# 或者直接用 Windows 原生 PowerShell：
Get-Content -Wait -Tail 30 "bridge.log"
```
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
2. **模型阶梯自愈接力与专属定制（Model Ladder）**：
   支持全局梯队（`DeepSeek 4.1` → `混元 4 Preview` → `DeepSeek Pro` → `智谱 GLM`），更支持任务级专属定制链（如 `ladder: ["glm-5.3", "hy4-preview-f"]` 或 `model: "glm-5.3 -> hy4"`）。中途遇到 429 限流或欠费，调度器在同会话内严格按指定顺序无缝接力。
3. **突破 300 秒硬超时 · 默认 2 小时充沛预算与超时现场保护**：
   异步后台长任务默认直接拔高至 **7200 秒（2 小时）**，调度器与系统等待脚本双向精准同步超时预算。特别引入【超时智能现场保护】：执行超时与硬故障彻底解耦，超时默认保留工作区已写入的完整代码与测试，不盲切新模型瞎写，而是向架构师输出结构化战报供精准决策。
4. **全自动放行与防踩踏**：
   底层固定注入 `-y` 和 `--permission-mode bypassPermissions`，改代码、跑单测全自动放行，绝不弹窗卡死；同时同一项目自动加上会话文件锁，防止多个 Agent 把工作区改炸。

---

## 🔌 宿主配置参考（按需粘贴）

### A. OpenAI Codex (`~/.codex/config.toml`)
> 💡 **提示**：运行 `npx github:cc1-blip/codebuddy-orchestrator init` 会自动读取你本机的绝对路径并生成好配置，无需手改！
```toml
[mcp_servers.codebuddy]
command = "node"
args = ["<你的绝对路径>/codebuddy-orchestrator/src/server.cjs"]
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
      "args": ["<你的绝对路径>/codebuddy-orchestrator/src/server.cjs"]
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
│   └── cli.js                   # 终端运维 CLI (doctor, install, init, login, logs, status, help)
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

## 🛡️ 安全合规与行为边界说明（写给严谨开发者与 AI 审计）

如果你或你的 AI 助手正在对本项目进行静态代码安全审计，以下是关键架构设计的安全边界公开说明：

| 关注项 | 行为事实与设计约束 | 为什么这样做？ |
| :--- | :--- | :--- |
| **`bypassPermissions`** | 仅用于 CodeBuddy 子进程启动参数，且**修改范围受限于当前工程目录**。 | CodeBuddy 作为后台无头（Headless）长任务运行时，若触发终端单步交互确认（`[y/N]`），进程会因无 TTY 输入而永久死锁挂起。我们遵循“架构师把关、工人自主实施”的原则，任务完成后仍由主架构师（Codex/Claude）独立进行门禁复测与代码审查。 |
| **进程回收 (`taskkill` / `SIGKILL`)** | **仅精准回收本任务自己拉起的特定子进程树 (通过 PID)**，绝对不扫描或触碰任何系统其他无关进程。 | 保证超时（Timeout）或服务停止（`stopWebUI`）时彻底释放本地计算资源与端口，杜绝孤儿进程与内存泄漏。 |
| **宿主配置修改 (`init --apply`)** | 默认 `init` 纯为 **Dry-Run 预览**；加 `--apply` 写入时，**强制先在原目录生成带毫秒时间戳的 `.bak` 备份文件**，且具备幂等性检查，绝不静默覆盖已有服务。 | 保护开发者的已有全局配置（如 `~/.codex/config.toml` 或 `claude_desktop_config.json`），随时可一键还原。 |
| **PowerShell `ExecutionPolicy`** | 仅在执行专用脚本的单次命令行中传递局部 `-ExecutionPolicy Bypass` 参数，**绝对不篡改、不持久化修改操作系统的全局注册表安全策略**。 | 规避 Windows 默认限制对自研自动化脚本的误拦截，确保开箱即用。 |

---

## 📄 开源协议
本项目采用 [MIT License](LICENSE)。欢迎尽情薅羊毛，把 AI 生产力发挥到极致！
