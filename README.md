<div align="center">

# Earendel 🌟

**A Runtime-Native Microkernel Operating System on V8**

Real syscalls. Real IPC. Real daemons.  
Not a simulator — an OS whose hardware layer *is* the browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(except%20xterm.js)-brightgreen)](#-architecture-highlights)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/techarts0/earendel/pulls)


[Live Demo](https://earendel.techarts.cn) · [Documentation](#architecture) · [License](#license)

</div>

---

## What is this?

Earendel is a POSIX-compliant microkernel OS that runs natively on the V8 JavaScript engine. It does **not** emulate x86 instructions (like v86/JSLinux) or simulate shell output (like web terminal toys). Instead, it treats the browser runtime as its hardware layer and builds real OS abstractions on top:

```
  User command: cat /etc/passwd
       ↓
  Shell → syscall(SYS_OPEN) → IPCBus → vfsd daemon → VFS tree lookup
       → syscall(SYS_READ) → IPCBus → vfsd → fd offset advance → return content
       → syscall(SYS_CLOSE) → IPCBus → vfsd → release fd
```

Every operation flows through syscall dispatch, IPC message routing, and user-space daemon processing — exactly like a real microkernel.

## Features

### 🔧 Microkernel & Syscalls

- Microkernel core: IPCBus, TaskScheduler, VMPageTable
- User-space daemons: `vfsd` (filesystem), `pmd` (process manager), `driverd` (devices), `capAgentd` (security)
- POSIX syscalls: `SYS_FORK`, `SYS_EXECVE`, `SYS_WAITPID`, `SYS_READ/WRITE/OPEN/CLOSE`, `SYS_KILL`, `SYS_FETCH`, `SYS_INFER`, and more
- Per-process PCB with file descriptor tables, signal queues, and capability tokens
- 100+ real Linux commands with pipes, redirects, `&&`/`||`, `for`/`if` control flow

### 📁 Virtual File System

Multiple persistence backends behind a unified VFS interface:

| Backend | Mount Point | Persistence |
|---------|-------------|-------------|
| IndexedDB | `/` | ✅ Persistent |
| Local Disk Image | configurable | ✅ Persistent |
| Cloud Image | configurable | ✅ Persistent |
| RAMVFS | `/tmp` | ❌ Volatile |

Full FHS directory structure, symlinks, permissions (DAC), and `mount`/`umount` support.

### 🤖 AI-Native OS

AI is not bolted on — it's a first-class OS citizen:

- **`SYS_INFER` syscall** — invoke LLM inference at the kernel level
- **`/dev/ai` character device** — `echo "prompt" > /dev/ai && cat /dev/ai`
- **`/etc/llm.conf`** — configure model, endpoint, API key, and parameters
- Any process can call AI through standard file I/O — no SDK required

### 🕹️ OS-Native Agent Framework

Built-in harness-skill agent architecture:

- **`skill` command** — execute `.md` skill files as agent workflows
- **`/dev/skill` character device** — programmatic agent invocation
- Agents run as first-class OS processes with full syscall access
- Skill files are plain Markdown — human-readable, version-controllable

### 🛠️ Toolchain

- **ECC Compiler** — compile JavaScript and WASM into single-file executable packages
- **JavaScript** as the native programming language (runs on the host V8)
- **Multi-runtime scripting**: Bash (full), JavaScript (native), Python (subset)
- **APT package manager** — `apt install/remove/update` with growing ecosystem *(WIP)*

### 🌐 Networking

- **`SYS_FETCH` syscall** — HTTP/1.1, HTTP/2, HTTP/3 compatible
- **WebSocket** support for persistent connections
- **WebRTC** for peer-to-peer communication
- Virtual firewall engine (`iptables`/`ufw` semantics)

### 🖥️ Hardware Abstraction Layer

The browser *is* the hardware. HAL maps Web APIs to POSIX device files:

| Web API | Device | Purpose |
|---------|--------|---------|
| WebGPU | `/dev/gpu0` | GPU compute & rendering |
| WebUSB | `/dev/usb0` | USB device access |
| WebAudio | `/dev/audio` | Sound I/O |
| Canvas/Framebuffer | `/dev/fb0` | Display output |
| Gamepad | `/dev/input/js0` | Game controller |
| Camera | `/dev/video0` | Video capture |

### 🪟 GUI

- Wayland-based compositor protocol
- Window management for graphical applications
- Terminal + GUI coexistence

### 🔍 Observability & Security

- **`strace`** — trace syscalls for any command in real-time
- **`ipc-trace`** — visualize IPC message flow between daemons
- **`capAgentd`** — capability-based security daemon with live guardrails  
  (e.g., intercepts `rm -rf /` before execution)

## Quick Start

Visit **[earendel.techarts.cn](https://earendel.techarts.cn)** — no install, no server, no signup.

Or run locally:

```bash
git clone https://github.com/techarts0/earendel.git
cd earendel
npm install
npm run dev
```

## Architecture

```
┌────────────────────────────────────────────────────┐
│                   User Space                       │
│  Shell ─→ Commands ─→ Scripts ─→ Agents            │
│      ↕ syscall()                                   │
├────────────────────────────────────────────────────┤
│  ┌──────┐ ┌─────┐ ┌───────┐ ┌─────────┐          │
│  │ vfsd │ │ pmd │ │driverd│ │capAgentd│  Daemons  │
│  └──┬───┘ └──┬──┘ └───┬───┘ └────┬────┘          │
│     └────────┴────────┴──────────┘                 │
│              IPCBus (message routing)              │
│              TaskScheduler (PCB + scheduling)      │
│              VMPageTable (page alloc + fault)       │
│                  Microkernel                        │
├────────────────────────────────────────────────────┤
│  V8 Engine · IndexedDB · Web APIs · WebWorkers     │
│              Hardware Layer (Browser Runtime)       │
└────────────────────────────────────────────────────┘
```

## Why not v86 / JSLinux / WebVM?

| | v86 / JSLinux | Earendel |
|---|---|---|
| Approach | Emulate x86 CPU instructions | Build OS abstractions on V8 |
| Kernel | Real Linux kernel on virtual hardware | Native microkernel on browser runtime |
| Binary compat | ✅ Runs x86 ELF binaries | ❌ Runs JS/WASM executables |
| Boot time | 3-10 seconds | Instant |
| Bundle size | ~30MB disk image | < 3MB |
| AI integration | ❌ | ✅ First-class (`SYS_INFER`) |
| Observability | Black box | Full transparency (`strace`, `ipc-trace`) |

Earendel is not trying to be a virtual machine. It is an **operating system whose hardware happens to be a JavaScript runtime**.

## License

[MIT](LICENSE)

---

<div align="center">

*The name "Earendel" comes from the oldest known English word for "morning star" — a light before dawn.*

</div>
