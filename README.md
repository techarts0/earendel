# 🌌 Earendel - Pure TypeScript Microkernel WebOS

> **A 100% browser-native, pure TypeScript POSIX-compliant microkernel operating system with zero backend dependencies, host disk mounting, and custom binary toolchain.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(except%20xterm.js)-brightgreen)](#-architecture-highlights)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/techarts0/earendel/pulls)

**Earendel** is an ultra-lightweight, high-performance Web Operating System written in pure TypeScript. Moving away from heavy WebAssembly-based x86 emulators and superficial "UI-only" desktop shells, Earendel implements a clean, POSIX-compliant microkernel architecture with Web Worker thread isolation, structured VFS, host disk mounting, and its own `ecc` compiler toolchain directly inside the browser.

👉 **Live Demo**: [https://earendel.techarts.cn](https://earendel.techarts.cn)  
*(Alternative Domain: [https://linux.techarts.cn](https://linux.techarts.cn) | Default Credentials: Username `hello` | Password `123456`)*  

---

## 🏛️ Architecture Highlights

```text
+-----------------------------------------------------------------------+
|                         Userland (Main Thread)                        |
|   xterm.js Terminal UI  |  GPU Canvas  |  DOM / Keyboard Listener    |
+-----------------------------------------------------------------------+
                                   |  (Zero-Copy / PostMessage IPC)
+-----------------------------------------------------------------------+
|                      Kernel Space (Web Worker)                        |
|  +---------------------+  +--------------------+  +----------------+  |
|  | Process Scheduler   |  |   VFS Block Engine |  |  Syscall API   |  |
|  | (PCB / Shared Memory)|  | (IndexedDB/Host)   |  | (`sys` / libc) |  |
|  +---------------------+  +--------------------+  +----------------+  |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                    Hardware Simulation & Storage                      |
|  IndexedDB Block Device  |  FileSystem Access API  |  Cloud VFS Sync  |
+-----------------------------------------------------------------------+
```

- **100% Pure TypeScript & Zero External Dependencies**: Built strictly with native Web APIs and TypeScript. Zero heavy NPM bloat (only uses xterm.js for TTY terminal rendering).
- **True Microkernel & Thread Isolation**: Kernel execution, process scheduling, and file I/O run on dedicated Web Worker threads, keeping the Main UI Thread running at a silky-smooth 60 FPS.
- **POSIX System Call API**: JavaScript acts as the system's "C Language". Userland apps invoke kernel operations via a structured sys module Promise API (`sys.open`, `sys.read`, `sys.write`, `sys.fork`, `sys.execve`).
- **Host Disk Mounting (`mount -t host`)**: Leverages Chrome's Native FileSystem Access API (`window.showDirectoryPicker`) to mount actual host machine directories directly into the virtual `/mnt` file tree.
- **Multi-Layer VFS Engine**: Seamlessly unifies IndexedDB block device persistence, Host Local Disk directories, and Cloud VFS remote sync.
- **Self-Contained Compiler & Binary Format**: Includes `ecc` (Earendel C/JS Compiler), compiling code into native Earendel Executable Format (`.eaf`) parsed and dispatched by the kernel.
- **apt Package Manager Support**: Designed with a built-in package manager to pull, install, and run userland binaries dynamically from remote repos.

💡 Why Earendel?

| Traditional VM / Wasm Emulator | Pure Front-End UI Shells | The Earendel Microkernel |
| :--- | :--- | :--- |
| ❌ Heavy & Slow: Takes seconds/minutes to download 100MB+ OS images | ❌ Fake OS: Just CSS/DOM dragging without actual process isolation | ⚡ Instant Boot: 0.1s startup time, ~30MB memory footprint |
| ❌ Black Box: Hard to inspect x86 assembly & Wasm bytecode | ❌ UI Blocking: Long-running loops freeze the browser main thread | 🛡️ Thread Isolated: Web Worker kernel guarantees 60 FPS Terminal UI |
| ❌ Isolated Sandboxes: Cannot directly read/write local host files | ❌ No Syscall Model: Lacks structured kernel system calls | 📂 Native Disk Access: Direct `mount -t host` Host FS integration |
| ❌ High Hosting Cost: Requires expensive backend VM orchestration | ❌ Superficial: Limited to basic string parser logic | 🎓 White-Box CS Learning: Inspect every Syscall in real-time (`strace`) |

---

## 🌟 Key Features

### 1. Real Hardware & Local Storage Integration
- **Host FS Mounting**: Run `mount -t host` under HTTPS to select and bridge a real folder on your Mac/PC directly into `/mnt/host`.
- **Hybrid VFS**: Filesystem Hierarchy Standard (FHS) featuring `/bin`, `/boot`, `/dev`, `/etc`, `/home`, `/lib`, `/mnt`, `/opt`, `/usr`, `/var`.
- **Time-Machine Snapshots**: Save (`snapshot save init`) and restore state in milliseconds with zero server delay.

### 2. Multi-Language Execution & Native Toolchains
- **Shell, Python 3, & JS Interpreters**: Run Python scripts, Shell pipelines, or native JS binaries.
- **ecc Compiler & .eaf Executables**: Compile userland code to Earendel Native Executable files and execute them seamlessly.
- **Syscall SDK (`earendel/sys`)**: Program custom userland applications targeting POSIX-like kernel APIs.

### 3. Full CLI & Real-Time System Tools
- **Subsystem Emulation**: Emulates Docker CLI (`docker ps`, `docker run`), Netfilter Firewall (`ufw`, `iptables`), and Process Utilities (`ps`, `top`, `htop`, `kill`).
- **tmux Terminal Multiplexer**: Split terminal views vertically (`tmux split`) or horizontally (`tmux split-h`) into active concurrent sessions.
- **Geek Culture**: Easter eggs including ASCII fireworks (`tell`), train animations (`sl`), 3D ASCII banners (`figlet`), and nuclear failsafes (`rm -rf /`).

---

## 🚀 Quick Start

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/techarts0/earendel.git

# Navigate to project directory
cd earendel

# Install dependencies (Minimal setup)
npm install

# Launch Vite dev server
npm run dev
```

Open your browser and visit `https://localhost:3000` or `http://localhost:3000`. Log in with username `hello` and password `123456`.

### Embedding in Web Apps / LMS

Earendel requires zero backend servers and can be embedded as a 100% client-side interactive lab iframe:

```html
<iframe 
  src="https://earendel.techarts.cn" 
  width="100%" 
  height="600px" 
  frameborder="0" 
  allow="clipboard-read; clipboard-write">
</iframe>
```

---

## 💻 Supported Commands Matrix

| Category | Commands |
| :--- | :--- |
| **File Management** | `ls`, `pwd`, `cd`, `cat`, `touch`, `mkdir`, `rm`, `cp`, `mv`, `head`, `tail`, `wc`, `find`, `which`, `whereis`, `mount`, `umount`, `xclip` |
| **Permissions & Users** | `chmod`, `chown`, `whoami`, `who`, `id`, `useradd`, `userdel`, `su`, `sudo`, `login`, `umask` |
| **Interpreters & Compiler** | `python3` (or `python`), `node` (or `js`), `ecc` (EAF Binary Compiler), `apt` (Package Manager) |
| **Text Editors** | `vi` (or `vim`), `nano` |
| **Networking & Security** | `ping`, `curl`, `ufw`, `iptables`, `tcpdump`, `traceroute` |
| **Process & Kernel** | `ps`, `top`, `htop`, `worker`, `kill`, `systemctl`, `df`, `free`, `uptime`, `time`, `crontab`, `dmesg`, `lsmod`, `modprobe`, `vmap`, `ipcs` |
| **Containers & Multiplexer** | `docker`, `tmux`, `snapshot` (backup, restore), `display`, `fbset`, `fbclear` |
| **Geek & Customization** | `theme`, `sound`, `man`, `alias`, `unalias`, `cheat`, `tell`, `sl`, `figlet` |

---

## 🎓 CS Education & Commercial Integration

Earendel is built to serve as an ideal environment for:

- **Operating System (OS) Courses**: Demonstrating processes, scheduling, virtual filesystems, and Syscall mechanisms without setting up complex C/GCC cross-compilers or heavy VMs.
- **Interactive EdTech Labs**: Embedding instant, zero-cost, crash-proof Linux lab terminals into online tutorials, coding bootcamps, or LMS platforms.
- **Browser-Native Utilities**: Building local-first Web IDEs, log inspectors, or terminal-based developer tools.

---

## 📜 License

Distributed under the MIT License. Free for personal, educational, and commercial use.
