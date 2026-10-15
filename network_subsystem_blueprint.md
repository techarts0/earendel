# Earendel 操作系统网络子系统 (Network Subsystem) 架构蓝图

本文档归纳总结了 **Earendel WebOS 统一网络抽象层 (Unified Network Subsystem)** 的系统调用设计与 `eslib.net` SDK 标准。

---

## 🏛️ 一、 统一网络系统调用规范 (Network Syscalls)

虽然浏览器限制了原生 L3/L4 TCP/UDP 原始套接字创建，但 Earendel 通过向内核注入统一的网络系统调用（Syscalls #30~33），将 **HTTP/1.1、HTTP/2、HTTP3 (QUIC)、WebSocket 与 WebRTC (P2P)** 统一整合为高度标准的 C/JS API：

```text
                        Earendel Unified Network Subsystem
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ Syscall #30: SYS_NET_FETCH   ──► HTTP/1.1, HTTP/2, HTTP3 (QUIC) 统一请求     │
 │ Syscall #31: SYS_NET_SOCKET  ──► WebSocket (全双工) & WebRTC DataChannel (P2P)│
 │ Syscall #32: SYS_NET_LISTEN  ──► WebRTC Peer-to-Peer 监听点                 │
 │ Syscall #33: SYS_NET_RESOLVE ──► DoH (DNS-over-HTTPS) 域名解析               │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         eslib.net C/JS 标准库抽象                           │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 二、 `eslib.net` C/JS 标准库接口设计

在应用代码、C 标头 `eslib.h` 或 `.eaf` 二进制中，开发者可直接调用统一的网络 SDK：

```javascript
// 1. 统一 HTTP/HTTP3 请求
const res = await eslib.net.fetch("https://api.github.com/zen", { method: "GET" });
console.log(res.status, res.body);

// 2. 统一全双工 Socket (支持 WebSocket 与 WebRTC P2P)
const socket = await eslib.net.socket("wss://echo.websocket.org", "ws");
socket.send("Hello Earendel!");
socket.onmessage = (data) => console.log("Received:", data);

// 3. 域名 DoH 解析
const ip = await eslib.net.gethostbyname("openai.com");
```

---

## 📁 三、 POSIX 伪网络字符设备 (`/dev/net/*`)

为支持纯 Shell 命令行下的网络流交互，增加伪网络设备：

- **/dev/net/fetch**：支持重定向触发 HTTP 请求：
  ```bash
  hello@earendel:~$ echo "https://api.openai.com/v1/models" > /dev/net/fetch
  ```
- **/dev/net/dns**：支持 DoH 域名解析：
  ```bash
  hello@earendel:~$ echo "google.com" > /dev/net/dns
  ```

---

统一网络抽象层设计完成！
