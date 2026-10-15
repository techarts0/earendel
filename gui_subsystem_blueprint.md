# Earendel 操作系统图形界面 (GUI) 与桌面合成器架构蓝图

本文档归纳总结了 **Earendel WebOS 图形界面与显示合成器 (Display Compositor Subsystem)** 的系统设计蓝图。

---

## 🏛️ 一、 Earendel-Wayland 桌面合成器架构 (`waylandd` PID 9)

借鉴现代 Linux Wayland 显示合成器思想，在用户态挂载 **`waylandd` (PID 9 桌面显示合成服务)**：

```text
                           Earendel Desktop Display Manager
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  Mode A: Web Components / React Window Manager (轻量级高颜值桌面 UI)         │
 │  Mode B: /dev/fb0 WebGL/WebGPU Framebuffer (WASM C 原生 GUI 绘图)           │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                  waylandd (PID 9 用户态 Display Compositor Daemon)          │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 二、 双模图形渲染架构 (Dual-Mode Rendering)

### 渲染模式 A：React / Web Component 极简高颜值桌面 (Web-Native GUI)
- **极简深色毛玻璃 (Glassmorphism Dark Mode)**：提供现代感视效与微动画；
- **多窗口拖拽管理器**：支持 Terminal 终端、Earendel Studio IDE、文件管理器与系统设置；
- **macOS / Next-Gen Linux Dock 栏**：支持任务栏图标置顶、悬浮与通知中心。

### 渲染模式 B：`/dev/fb0` 显存帧缓冲与 WebGPU 绘图 (WASM Direct GUI)
- **C / Rust WASM 图形框架直连**：支持 C/C++/Rust 应用在 WASM 沙箱中通过 LVGL、Dear ImGui、Raylib 或 SDL2 绘制 GUI；
- **`/dev/fb0` Compositor 复合**：应用写入 `/dev/fb0` 的 RGBA 像素流直接由 `waylandd` 合成为桌面窗口！

---

## 🧠 三、 Agent-Native 智能化 GUI 特色

1. **全局 Agent 快捷命令行 (`Ctrl/Cmd + K`)**：
   - 随手唤醒全局 AI 命令行，输入自然语言（如 `"帮我把 /tmp 下的文件按日期分类整理"`），直接触发 `harnessEngine` 在后台执行，并实时弹出 ANSI 渲染进度小工具！
2. **`.md` Skill 可视化拓扑画布 (Visual DAG Flow Canvas)**：
   - 双击 `.md` 技能文件或 `.eaf` 二进制，自动在 GUI 窗口中以 React Flow 节点图实时渲染 `harnessd` 的 FSM 状态流转与拓扑执行轨迹！

---

GUI 图形显示与 Agent 桌面架构蓝图设计完成！
