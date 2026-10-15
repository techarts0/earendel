# Earendel Agent-First OS 重构蓝图与实施纲领 (Master Blueprint)

本文档归纳总结了 **Earendel 操作系统 Agent-First 范式重构蓝图**。待 Token 额度恢复后，全量开发将严格遵循本纲领大刀阔斧展开！

---

## 🏛️ 一、 核心两大不动摇原则 (Core Principles)

1. **底座微内核绝对稳定 (Stable Microkernel Unchanged)**：
   - 保持微内核底层机制（IPC 消息总线 `ipcBus`、虚拟内存页表 `vmPageTable`、PCB 进程调度器 `taskScheduler`、VFS 文件系统框架 `vfsd`、设备驱动 `driverd`）100% 稳定不动。
2. **顶层 POSIX / UNIX 标准兼容绝对不变 (100% POSIX Compatible)**：
   - 保证现有 Shell 脚本 (`.sh`)、C 语言工具链、`cat`/`grep`/`find` 等传统 UNIX 命令 100% 原生运行。
   - 所有传统 POSIX 命令通过适配器自动包装为原生的 `POSIXCommandSkill`（原子技能）。

---

## 🚀 二、 AI-Native 内核原语 (Physical Kernel AI Primitives)

1. **`/dev/ai` 物理字符设备驱动 (`vfs.ts`, `driverd.ts`)**：
   - 贯彻 UNIX “一切皆文件” 哲学。
   - 支持写入提示词重定向：`echo "分析日志" > /dev/ai`；
   - 支持管道流式处理：`cat /var/log/syslog | grep error | /dev/ai`；
   - 赋权 `rwxrwxrwx` 物理可执行位与 Shell 管道自动捕获。
2. **`SyscallNo.SYS_INFER` (25 号系统调用) & `/etc/llm.conf`**：
   - 降维下沉 AI 推理为物理 25 号系统调用；
   - 解析 `/etc/llm.conf` 系统配置（KEY=VAL 格式，支持 `BASE_URL`、`MODEL_NAME`、`API_KEY`）；
   - 支持 OpenAI / DeepSeek / 局域网及本地免 Key Ollama / LM Studio 物理 HTTP `fetch()` 通信；
   - 无 Key 或断网时秒切内核自愈诊断引擎，物理透传 HTTP 401/404 Error 状态。

---

## 🏛️ 三、 Harness + Skill Agent-First 重构架构

摒弃脆弱的 ReACT 提示词死循环，引入白盒化、高并发、秒自愈的 **Harness + Skill** 系统架构：

```text
                           Earendel Agent-First OS
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. POSIX 兼容层: 100% POSIX / UNIX Standard (POSIXCommandSkill 自动包装)      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Agent 调度层: harnessd (PID 7 FSM Daemon) + Skill Spec (AbstractSkill)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. 运行沙箱层: SkillRuntimeContainer (Web Worker / WASI 硬件级隔离)         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. 微内核底座: Earendel Stable Microkernel (IPC, VFS, PCB, VM 绝对稳定)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. `SkillRuntimeContainer`（内核态沙箱容器）
- 映射浏览器底层算力 CPU（JS 引擎与 WASM 栈虚拟机）；
- 只负责**单个原子级 JS / WASM Skill 的物理隔离执行**；
- JS Atomic Skill 路由至 Web Worker 隔离线程，WASM Atomic Skill 路由至 WASI 安全算力沙箱。

### 2. `harnessd`（用户态 FSM 守护进程，PID 7）
- **控制面分解 (Composed Skill Decomposition)**：当 `./app.eaf` 组合技能被唤起时，`harnessd` 首先对其进行 AST/Manifest 解构，将其拆解为由原子 Skill 组成的 Skill DAG 依赖图；
- **Context Convergence Engine（上下文收敛器）**：自动收敛多 Skill 链式调用中的 I/O、Env、VFS 与推理上下文，自动将前序 Skill 的输出传递给后续 Skill；
- **Harness Guard（10ms 熔断自愈）**：Watchdog 超时监控，原子 Skill 卡死/溢出时 10ms 内物理熔断与状态回滚；
- **Skill 物理派发 (`SYS_SKILL_EXEC`)**：按照拓扑顺序，通过系统调用 `syscall(SyscallNo.SYS_SKILL_EXEC, atomicSkill)` 将拆解出的单个原子 Skill 投递给内核 `SkillRuntimeContainer` 去真正隔离执行！

### 3. Skill 抽象契约与语法
- **`AbstractSkill` 抽象接口**：规定输入 Context、输出 Result 与 `execute()` 函数；
- **Earendel Skill DSL**：YAML/JSON 声明式编排拓扑。

---

## 🛠️ 四、 工具链与多语言 SDK 生态 (Toolchain & SDKs)

1. **`ecc 2.0` WASM Section 机制处理**：
   - `ecc` 在打包 WASM 时**无需遍历逐条反汇编指令**（那属于 LLVM 优化 pass 的职责）；
   - `ecc` 采用极致高效的 WASM 头部段（Section Header）解析算法，精准扫描 Section 2 (Imports) 与 Section 7 (Exports)，自动提取依赖的底层 Syscall 句柄与 `AbstractSkill` 符号。
2. **多语言原生 `eslib` 标头库 (`eslib.h` / `eslib-rs` / `eslib-go`)**：
   - 提供极轻量级 C/C++ 标头 `eslib.h`、Rust `eslib` Crate 与 Go `eslib` Package；
   - 让 C/Rust/Go 原生代码在 `clang`、`rustc`、`tinygo` 编译时直接打入底层 `SYS_INFER` 与微内核 Syscall 标头，实现 100% 编译通过！
3. **`harnessd` 脚本与 `.eaf` 的统一托管**：
   - 无论是 `.sh` Shell 脚本、`.py` Python 脚本、`.js` 脚本还是 `.eaf` 组合二进制，全部由 `shellEngine.ts` 统一托管给 `harnessd` (PID 7)；
   - 所有脚本统一享受 FSM 状态追溯、上下文收敛与 10ms 熔断自愈服务！

## 🎨 五、 Earendel Studio (内置 Agent IDE)
   - 集成 Monaco 编辑器（支持 DSL/JS/WASM）；
   - Skill DAG 动态拓扑图可视化拖拽与执行轨迹追踪；
   - 一键 `ecc` 编译生成 `.eaf` 并投递给 `SkillRuntimeContainer` 测试。

---

## 🛡️ 五、 国防级反胁迫 `ram-vfs` 战术文件系统

1. **纯 RAM 挥发性存储 (`ram-vfs`)**：
   - 文件节点与字节数据严格存储在内存 `ArrayBuffer` 中，屏蔽任何磁盘/IndexedDB 写入，真正实现**关机/断电物理零痕迹留存**；
2. **Crypto-Zeroing 内存自毁覆写**：
   - 输错 2 次密码 / 胁迫伪密码 / 云端 WebSocket 遥毙信号触发时，执行 `ArrayBuffer.fill(0x00)` 全内存覆写擦除并触发 Kernel Panic！

---

本蓝图已永久持久化入项目库，随时可按此准则开工！
