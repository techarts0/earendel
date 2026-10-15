# Earendel POSIX-Native Harness-Skill 增量设计方案 (SOTA 2026)

本文档归纳总结了基于纯正 POSIX UNIX 风格的 **`/dev/skill` 与 `harnessEngine` 增量演进设计方案**。

---

## 🏛️ 一、 纯正 POSIX 交互接口与 Shebang 校验

为了防止用户误传非 Skill 的普通文件消耗 Token，模仿 Linux 的 `#!/bin/bash` 引入标准的 Shebang 物理校验：

```markdown
#!/dev/skill
# Title: Excel Analysis Skill
# Author: Earendel User

请帮我分析 /tmp/data.csv 文件，提取异常行并输出总结报告。
```

- **Shebang 零 Token 快速拦截**：`harnessEngine` 读取文件首行，若不包含 `#!/dev/skill` 或 `<!-- earendel-skill -->`，**直接 0 毫秒报错退出，零 Token 消耗！**

---

## 🏛️ 二、 `harnessEngine` 5-State 状态机设计 (FSM Design)

```text
 ┌──────────────┐     Success     ┌──────────────┐     Success     ┌──────────────┐
 │  1. PARSE    │ ──────────────► │  2. INFER    │ ──────────────► │  3. ACT      │
 └──────┬───────┘                 └──────┬───────┘                 └──────┬───────┘
        │ Fail (无 Shebang)               │                                │
        ▼                                ▼ (Max 3 重试)                   ▼
 ┌──────────────┐                 ┌──────────────┐          Fail (exitCode !== 0)
 │  5. ERROR    │ ◄────────────── │ 4. REFLEXION │ ◄──────────────────────────┘
 └──────────────┘ (超过重试上限)  └──────┬───────┘
        ▲                                │
        └────────────────────────────────┘ (带错误修正重试)
                        │
                        ▼ (步骤完成且校验正确)
                 ┌──────────────┐
                 │  6. SUCCESS  │
                 └──────────────┘
```

1. **`PARSE` (解析校验)**：首行读取 `#!/dev/skill`。校验失败直接切入 `ERROR` 终止；校验成功切入 `INFER`；
2. **`INFER` (推理规划)**：调用 `SYS_INFER` 生成当前步骤的目标 Tool 与参数，切入 `ACT`；
3. **`ACT` (动作执行)**：经 `capAgentd` 防火墙审计，交付 `shellEngine` 执行命令。执行成功且验证正确切入 `SUCCESS`；报错切入 `REFLEXION`；
4. **`REFLEXION` (自愈反思)**：自增重试计数器 (`retries++`)。若 `retries > 3` 触发熔断切入 `ERROR`；否则将 `stderr` 送回 `SYS_INFER` 自愈修参数，切回 `INFER` 重新尝试！

---

## 🚀 二、 2026 SOTA 级 `harnessEngine` 核心架构 (4 大最新技术)

基于 2026 年大模型领域最新的 Agent 原理（Anthropic Tool Use、Reflexion 自适应反思、Guardrail FSM）：

```text
               cat skill.md | /dev/skill  OR  skill skill.md
                                   │
                                   ▼
                   src/core/harnessEngine.ts (增量引擎)
    ┌─────────────────────────────────────────────────────────────┐
    │ 1. Intent & Tool Discovery (意图分析与系统工具匹配)          │
    │ 2. Adaptive Self-Correction Loop (Reflexion 自动自我纠错)   │
    │ 3. Security Guardrail (`capAgentd` 物理防护与提权校验)      │
    │ 4. Structured ANSI Progress Stream (实时可视化管道流)        │
    └──────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
          shellEngine / Syscall #25 (物理执行与真实 Tool 调度)
```

### 1. 动态意图与工具匹配 (Intent & Tool Discovery)
- `harnessEngine` 接收自然语言 Prompt 流后，自动扫描系统 VFS 中已注册的 POSIX 工具与二进制（`ls`、`grep`、`ecc`、`sys_infer`）；
- 结合 `SYS_INFER` 秒级合成目标执行计划，开发者无需手工声明 Schema！

### 2. Reflexion 自适应反思与报错自愈 (Self-Correction Loop)
- **2026 最强 Agent 特性**：当调用的命令执行失败（`exitCode !== 0` 或 `stderr` 报错）时；
- `harnessEngine` 捕捉到错误日志，自动将其与上下文打包送回 `SYS_INFER`：“该工具报错，请修正参数重试”；
- 自动尝试重新修正参数与工具，实现物理级的无人值守自愈！

### 3. `capAgentd` 零信任安全护栏 (Zero-Trust Guardrail)
- 在 `harnessEngine` 正式派发具体 Shell 命令前，统一经过微内核 `capAgentd` 意图防火墙；
- 高危动作（如高危删除、敏感文件窃取）秒级拦截并提示用户二次 Confirm。

### 4. ANSI 彩色结构化流式反馈 (ANSI Visual Progress Streaming)
- 实时向 Shell 控制台输出格式优雅的进度与思考轨迹：
  ```text
  [HarnessEngine] Skill Execution Loaded (Source: excel_analysis.md)
  [Plan 1/3] Scanning VFS directory for excel files... -> Done.
  [Plan 2/3] Extracting data using python... -> Done.
  [Plan 3/3] Generating summary report via /dev/ai... -> Success.
  ```

---

## 💡 三、 增量落地计划

1. **`/dev/skill` 字符设备节点挂载 (`vfs.ts`, `driverd.ts`)**：
   - 挂载 `/dev/skill` 节点，向该节点写入流内容自动唤醒 `harnessEngine`；
2. **`skill` 内置 CLI 脚本 (`shellEngine.ts`)**：
   - 增加 `skill` 内置命令支持；
3. **`src/core/harnessEngine.ts` 增量模块**：
   - 实现包含 Reflexion 自自愈与 `SYS_INFER` 工具匹配的调度逻辑。

纯粹 POSIX 风格，架构优雅通透！
