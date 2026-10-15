# Earendel Agentic Context & Memory 管理子系统开发方案

本阶段将在 Earendel OS 中完整落地 **分层 Context 与 Memory 管理子系统**，实现：
1. **L0 瞬时草稿板 (`/tmp/agent/<pid>/`)**：大体积输出自动落盘，Prompt 仅传递文件路径指针（0-Token 浪费）。
2. **L1 工作记忆滑动折叠 (Action Rollup Compaction)**：多轮交互历史自动提炼折叠，严格控制 Token 预算。
3. **L2 会话审计流 (`/var/log/harness/`)**：记录全周期 FSM 事件日志。
4. **L3 用户偏好 (`~/.agent_profile`) 与经验库 (`/var/lib/harness/memory/lessons.md`)**：JIT 动态知识装配与 Reflexion 成功反思沉淀。

---

## User Review Required

> [!IMPORTANT]
> 1. **大输出重定向机制**：当单次 Shell 执行输出超过阈值（如 1200 字符）时，Harness 会自动将其持久化到 `/tmp/agent/<pid>/stdout_<index>.raw`，并在 Prompt 中只放入关键信息摘要和文件路径提示，使 Agent 学会用 `grep` / `head` 等工具精准读盘。
> 2. **用户偏好无感注入**：如果当前用户主目录下存在 `~/.agent_profile`，Harness 会自动读取并以 `[User Preferences & Context]` 块注入 Prompt，实现个性化交互。
> 3. **UI 零侵入**：所有改动纯内核/Core 逻辑，UI 布局、样式和文字完全不作任何修改。

---

## Proposed Changes

### 1. Core / Memory Engine 记忆管理器

#### [NEW] [memoryEngine.ts](file:///d:/project/web/earendel/src/core/memoryEngine.ts)
- 实现 `AgentMemoryManager` 单例：
  - **L0 Scratchpad**: `createScratchpad(vfs, pid)`, `writeScratchpadFile(vfs, pid, filename, content)`, `cleanupScratchpad(vfs, pid)`。
  - **L1 Compaction**: `condenseHistory(historyTurns)` 实现过往轮次命令折叠。
  - **L2 Session Log**: `appendSessionAudit(vfs, record)` 写入 `/var/log/harness/`。
  - **L3 Profile & Lessons**: `loadUserProfile(vfs, user, home)` 读取 `~/.agent_profile`，`loadLessonsLearned(vfs)` 读取经验规则，`recordLesson(vfs, skillName, summary)` 在反思成功后自动沉淀规则。

---

### 2. Core / Harness Engine 深度装配

#### [MODIFY] [harnessEngine.ts](file:///d:/project/web/earendel/src/core/harnessEngine.ts)
- 在 `executeSkill` 生命周期中：
  - 启动阶段：分配虚拟执行 PID，创建 `/tmp/agent/<pid>/` 沙箱。
  - 装配阶段：调用 `loadUserProfile` 和 `loadLessonsLearned`，将用户偏好与过往经验拼装进 System Prompt。
  - ACT 阶段：输出超过 1200 字符时，自动写入 Scratchpad 并生成文件路径提示；若有反思发生并在后续轮次修复成功，触发 `recordLesson` 提炼经验。
  - 退出阶段：写入 L2 Session Log，清理 L0 临时沙箱。

---

### 3. VFS 初始目录与配置文件

#### [MODIFY] [vfs.ts](file:///d:/project/web/earendel/src/core/vfs.ts)
- 初始化记忆基础设施目录与文件：
  - `/tmp/agent/` 目录。
  - `/var/log/harness/` 目录。
  - `/var/lib/harness/memory/lessons.md`（初始内置系统运维经验规则）。
  - `/etc/agent/default_profile.json`（系统默认 Agent 行为准则）。
  - `/home/hello/.agent_profile`（hello 用户的个人偏好配置）。

---

## Verification Plan

### 自动化与逻辑验证
1. **L0 Scratchpad 验证**：
   - 模拟执行长文本输出（> 1200 字符），验证在 `/tmp/agent/<pid>/` 中成功生成 `stdout_*.raw`，且 Prompt 中包含正确的文件路径提示。
2. **L1 Compaction 验证**：
   - 模拟 4 轮以上的交互，验证第 1~2 轮历史在 Prompt 中被折叠为 `[Action Rollup]` 摘要，保留最新的 Raw 交互。
3. **L3 Profile 注入验证**：
   - 在 `/home/hello/.agent_profile` 中配置自定义偏好（如 `language: zh-CN`, `style: concise`），验证 Harness 组装的 System Prompt 正确包含该偏好。
4. **L3 Lessons Learned 沉淀验证**：
   - 验证在经历 `REFLEXION` 并在下一轮成功时，`/var/lib/harness/memory/lessons.md` 正确追加新经验记录。

### 编译构建验证
- 确保 TypeScript 编译无报错。
