# 🌌 Earendel - Pure TypeScript Web Linux Terminal

> **The zero-backend, 100% browser-native Linux OS simulator built for modern computer science education, interactive labs, and tech embedding.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.0+-61dafb?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646cff?logo=vite)](https://vitejs.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/techarts0/earendel/pulls)

**Earendel** is an ultra-lightweight, zero-cost-to-host Linux terminal emulator written in pure TypeScript. Designed to solve the traditional headaches of OS labs—such as heavy VMware setups, server maintenance costs, and broken student environments—Earendel delivers a complete Linux TTY experience directly in the browser with **instant boot, 0s latency, and 100% client-side privacy.**

👉 **Live Demo**: [http://linux.techarts.cn](http://linux.techarts.cn)  
*(Default Credentials: Username `hello` | Password `123456`)*

---

## 💡 Why Earendel? (The EdTech Pain Points Solved)

| Traditional Linux Labs (VMware / AWS Cloud Shell) | The Earendel Advantage |
| :--- | :--- |
| ❌ High server costs ($100s/mo for backend VM clusters) | **⚡ $0 Server Cost**: Runs 100% on student's browser CPU/Memory |
| ❌ Complex setup (VMware, BIOS virtualization errors) | **🚀 Zero Setup**: Open a URL, start learning in 3 seconds |
| ❌ Risk of broken environments & system crashes | **🛡️ One-Click Reset**: Instant VFS snapshot rollback |
| ❌ Privacy & Security concerns with shared servers | **🔒 Completely Isolated**: Local IndexedDB storage, zero server leakage |

---

## 🌟 Key Features & Highlights

### 🎓 1. Built for CS & Linux Education
- **FHS & Persistent VFS**: Fully implemented **Filesystem Hierarchy Standard** (`/bin`, `/boot`, `/dev`, `/etc`, `/home`, `/lib`, `/opt`, `/usr`, `/var`) with IndexedDB persistence and `/var/log/syslog` boot logs.
- **Time-Machine Snapshots**: Save (`snapshot save init`) and restore/rollback state instantly in milliseconds if students mess up the environment.
- **Native Python 3 & Node.js Runtimes**: Execute `.py` files with loops, variables, and math, or run `.js` scripts directly on browser V8 with custom `console.log` and `process.argv` handling.

### 🐧 2. Rich CLI & Real-Time Subsystems
- **Virtual Docker Suite**: Emulates Docker CLI (`docker ps`, `docker ps -a`, `docker images`, `docker run -it`, `docker stop`, `docker rm`).
- **Netfilter Firewall (`ufw` & `iptables`)**: Simulate network security rules blocking dynamic `curl` or `ping` requests in real-time.
- **`tmux` Terminal Window Multiplexer**: Split your browser screen vertically (`tmux split`) or horizontally (`tmux split-h`) into multiple independent active terminal sessions.
- **Geek Easter Eggs**: Includes `tell <name>` (ANSI ASCII fireworks), `rm -rf /` (nuclear bomb failsafe easter egg), `sl` (steam locomotive animation), and `figlet` (3D ASCII banner font generator).

### 🎨 3. Highly Customizable & Embeddable
- **5 Sleek Color Themes**: Switch instantly with `theme` between `default`, `matrix`, `dracula`, `cyberpunk`, and `monokai`.
- **Easy Web Embedding**: Packaged as an iframe or React component for LMS (Canvas, Moodle) or technical blogs.

---

## 🚀 Quick Start

### For Developers

git clone https://github.com/techarts0/earendel.git
cd earendel
npm install
npm run dev

Open your browser and visit `http://localhost:3000`. Login with username `hello` and password `123456`!

### For Educators & Bloggers (Embed in 1 Minute)
Simply embed Earendel into your online course, documentation, or blog via Iframe:

<iframe src="http://linux.techarts.cn" width="100%" height="600px" frameborder="0"></iframe>

---

## 💻 Supported Commands Matrix

| Category | Commands |
| :--- | :--- |
| **File Management** | `ls`, `pwd`, `cd`, `cat`, `touch`, `mkdir`, `rm`, `cp`, `mv`, `head`, `tail`, `wc`, `find`, `which`, `whereis`, `locate`, `mount`, `umount`, `xclip` |
| **Permissions & Users** | `chmod`, `chown`, `whoami`, `who`, `id`, `useradd`, `userdel`, `su`, `sudo`, `login`, `umask` |
| **Interpreters** | `python3` (or `python`), `node` (or `js`) |
| **Text Editors** | `vi` (or `vim`), `nano` |
| **Networking & Security** | `ping`, `curl`, `ufw`, `iptables`, `tcpdump`, `traceroute`, `ssh`, `ssh-keygen`, `mesh` |
| **Container & Process** | `docker`, `ps`, `top`, `htop`, `worker`, `kill`, `systemctl`, `apt`, `df`, `free`, `uptime`, `time` |
| **Multiplexer & Snapshot**| `tmux`, `snapshot` (`backup`, `restore`) |
| **Geek & Customization** | `theme`, `sound`, `man`, `alias`, `unalias`, `cheat`, `tell`, `sl`, `figlet` |

---

## 🏢 Enterprise & Commercial Use (EdTech / B2B)

Looking to integrate Earendel into your university, bootcamp, or commercial learning platform?

- **Custom Interactive Courses**: Pre-define files, labs, and interactive step-by-step terminal challenges.
- **LMS Integration**: Webhook/API hookups for automated assignment grading and submission.
- **White-Labeling**: Custom branding, default themes, and pre-installed toolchains.

📩 **Contact for Institutional Support**: Open a [GitHub Discussion](https://github.com/techarts0/earendel/discussions) or reach out directly.

---

## 📜 License

Distributed under the **MIT License**. Free for personal, educational, and commercial use.

---

<p align="center">
  <i>Crafted with ❤️ for students, terminal lovers, and geek culture enthusiasts worldwide.</i>
</p>