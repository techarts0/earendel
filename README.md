# 🌌 Earendel (埃兰迪尔) - Pure TypeScript & WASI Web Linux OS Terminal

> **The zero-backend, 100% browser-native Linux Web OS powered by POSIX VFS, WebAssembly (WASI), and dynamic Cloud APT Package Ecosystem.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-WASI-red?logo=webassembly)](https://webassembly.org/)
[![React](https://img.shields.io/badge/React-18.0+-61dafb?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646cff?logo=vite)](https://vitejs.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/techarts0/earendel/pulls)

**Earendel (埃兰迪尔)** is an ultra-lightweight, zero-cost-to-host Web Linux Terminal and operating system engine written in pure TypeScript. Built with standard **Filesystem Hierarchy Standard (FHS)**, a **Three-Tier Storage Hierarchy (RAM / NV-RAM / Cloud IMG)**, and an **authentic POSIX WASI & JS Closure Dual Runtime Engine**, Earendel delivers a complete Linux TTY experience directly in the browser with **instant boot, 0s latency, 100% client-side privacy, and dynamic APT cloud package distribution.**

👉 **Live Demo**: [http://linux.techarts.cn](http://linux.techarts.cn)  
*(Default Credentials: Username `hello` | Password `123456`)*

---

## 🌟 Architecture & Core Infrastructure Highlights

```text
  +-----------------------------------------------------------------------+
  |                   Earendel Web Operating System                       |
  +-----------------------------------------------------------------------+
  |  [Layer 1: User Interface]   xterm.js / Theme Manager / Sound Engine |
  +-----------------------------------------------------------------------+
  |  [Layer 2: Execution Engine] POSIX Shell Engine / Command Registry    |
  +-----------------------------------+-----------------------------------+
  |  [JsRuntimeEngine]                |  [WasmRuntimeEngine]              |
  |  Node.js Closure Sandbox          |  POSIX WASI Preview 1 Vectors     |
  +-----------------------------------+-----------------------------------+
  |  [Layer 3: APT Package Subsystem] `apt` / `dpkg` / `/var/lib/dpkg/`  |
  +-----------------------------------------------------------------------+
  |  [Layer 4: Three-Tier Storage]  RAM (VFS) <-> NV-RAM (IndexedDB)    |
  |                                 <-> Local Disk / Cloud Hub (.ear)    |
  +-----------------------------------------------------------------------+
```

### 🏛️ 1. Pure-Blood Linux Filesystem Hierarchy & 3-Tier Storage Model
- **Strict FHS Compliance**: Complete Unix directory skeleton (`/bin`, `/boot`, `/dev`, `/etc`, `/home/hello`, `/lib`, `/opt`, `/usr/bin`, `/var/cache/apt/archives`, `/var/lib/dpkg/info`).
- **3-Tier Storage Engine**:
  - **L1 RAM**: Ultra-fast in-memory CLI evaluation tree;
  - **L2 NV-RAM (IndexedDB)**: Persistent non-volatile RAM auto-restoring VFS state across browser reloads;
  - **L3 Cold / Cloud Storage (`.earendel-img`)**: Exportable self-verifying encrypted `.earendel-img` files with salted SHA-256 HMAC checksums, zero-collision machine UUIDs (`usr_<hash>`), and cloud REST Hub push/pull roaming.

### ⚡ 2. Dual Infrastructure Runtimes (JS & POSIX WASI Engine)
- **`JsRuntimeEngine`**: Isolated Function closure sandbox injecting virtualized `console` redirection, `process.env`, and `process.argv` to execute CommonJS/ES Module bundles seamlessly.
- **`WasmRuntimeEngine`**: Authentic **POSIX WASI (WebAssembly System Interface Preview 1)** runtime supporting memory vectors (`fd_write`), C/Rust `argc`/`argv` memory pointer injection (`args_get`), high-precision timers (`clock_time_get`), and Web Crypto random seeds.

### 📦 3. Dynamic Cloud APT & DPKG Ecosystem (`*.ear` Packages)
- **Authentic Network Physical Boundary**: Real HTTP network error handling for `apt update` and `apt install` pointing to official repo (`http://repo.linux.techarts.cn`).
- **Earendel Native `.ear` Package Format**: Packages are self-contained `.ear.json` archives containing metadata and executable closures.
- **6-Layer Physical Package Persistence**:
  1. `/var/cache/apt/archives/*.ear` (Original downloaded archives)
  2. `/usr/lib/${pkg}/bundle.json` (Unpacked extracted runtime payload)
  3. `/usr/bin/${cmd}` (Executable Shebang symbols with `rwxr-xr-x` permissions)
  4. `/var/lib/dpkg/status` (Plain text DPKG status database)
  5. `/var/lib/dpkg/info/${pkg}.info` (Metadata for `apt upgrade` version diffing)
  6. `/var/lib/dpkg/info/${pkg}.list` (Clean physical file list for `apt remove`)

---

## ⚡ Quick Command Reference

### 🌐 VFS Remote Image Hub & Disk I/O Commands
```bash
# Push VFS snapshot to local disk (.earendel-img download) or cloud REST Hub
vfs push

# Pull VFS snapshot from local disk file picker or remote cloud Hub
vfs pull

# Configure cloud Remote Hub URL and password (auto-generates Machine UUID)
vfs remote set-url http://hub.linux.techarts.cn
vfs remote set-credential mysecretpass
```

### 📦 APT & DPKG Package Management Suite
```bash
# Update package index from official REST repo
sudo apt update

# Install dynamic JS or WebAssembly packages (.ear.json)
sudo apt install cowsay
sudo apt install http://cdn.example.com/custom_app.ear.json

# Smoothly upgrade all installed packages using SemVer comparison
sudo apt upgrade

# Perform clean physical removal of installed packages
sudo apt remove cowsay

# Query authentic DPKG physical status database
dpkg -l
```

### ⚡ WASM & System Computation
```bash
# C-compiled Native WebAssembly Calculator
wasm-calc 10 * 20

# Rust-compiled Native WebAssembly SHA-256 Crypto Engine
wasm-sha256 "Hello Earendel Web OS"
```

---

## 📄 `.ear.json` Package Specification

```json
{
  "name": "cowsay",
  "version": "1.0.0",
  "type": "js",
  "sizeKb": 120,
  "description": "Configurable speaking cow in ASCII art",
  "executables": [
    {
      "name": "cowsay",
      "description": "Configurable speaking cow in ASCII art",
      "category": "text"
    }
  ],
  "code": "/* JavaScript Closure Bundle Source */"
}
```

---

## 🚀 Quick Start (Local Development)

```bash
# Clone the repository
git clone https://github.com/techarts0/earendel.git

# Enter project directory
cd earendel

# Install dependencies
npm install

# Run local development server
npm run dev
```

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for details.
Made with ❤️ by the **Techarts Team**.