# AGENTS.md - 架构师与长任务执行规范

## 1. 核心定位与角色分工
- 主 Agent 作为**总控架构师与独立审查者 (Lead Architect & Independent Reviewer)**：负责需求拆解、任务契约把控、门禁验收；不得代替实施 Worker 编写业务代码。
- 子 Agent (CodeBuddy) 作为**重型实施工人 (Implementation Worker)**：负责代码实现、补足单测、全量门禁自测与格式化交付。

## 2. 异步长任务反轮询准则 (Anti-Polling Policy)
当发起耗时较长（>3分钟）或多模块重构任务时：
1. **严禁使用短轮询或定时循环**：
   严禁使用 `Start-Sleep`、`-Timeout 15/55` 等带有隐式轮询的循环指令，严禁在执行中高频反复调用 `codebuddy_task_status`。
2. **唯一等待途径：操作系统内核原生阻塞 (One-Shot Kernel Wait)**：
   任务启动后，获取子进程 `PID` 与 `waitCommand`，直接以单次命令挂起等待：
   - Windows: `powershell -ExecutionPolicy Bypass -File <path>/wait-job.ps1 -TaskId <taskId> -ProcessId <pid>` 或 `Wait-Process -Id <pid>`
   - macOS/Linux: `bash <path>/wait-job.sh --task-id <taskId> --process-id <pid>`
3. **即时唤醒机制**：
   操作系统内核会在子进程退出瞬间以毫秒级自动放行控制权。唤醒后仅单次读取交付报告并开展独立审查。
