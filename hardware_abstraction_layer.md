# Earendel 操作系统硬件抽象层 (HAL) 与硬件绕过桥梁蓝图

本文档归纳总结了 **Earendel WebOS 硬件抽象层（Hardware Abstraction Layer, HAL）** 的驱动映射标准，以及绕过浏览器禁锢访问物理原生硬件的 3 大通道。

---

## 🏛️ 一、 浏览器原生可访问硬件的 `/dev/*` 抽象映射表

Earendel 通过 `driverd.ts`（物理设备驱动服务）与 `vfs.ts`，将浏览器原生 Web API 抽象为 100% 符合 POSIX 标准的 `/dev/*` 设备文件：

```text
               Earendel Hardware Abstraction Layer (HAL)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ /dev/fb0, /dev/gpu0 ──► WebGPU / WebGL 2.0 (图形与显卡算力抽象)             │
 │ /dev/dsp            ──► Web Audio API / MediaDevices (音频输入输出抽象)     │
 │ /dev/ttyUSB0        ──► Web Serial API (串口/IoT/单片机抽象)                │
 │ /dev/bus/usb/*      ──► WebUSB API (原生 USB 控制器抽象)                    │
 │ /dev/bt0            ──► Web Bluetooth API (蓝牙 LE 抽象)                    │
 │ /dev/video0         ──► Media Capture (摄像头抽象)                          │
 │ /dev/gps0           ──► Geolocation API (GPS 定位抽象)                      │
 │ /dev/nvme0n1        ──► OPFS / IndexedDB (物理闪存与磁盘抽象)              │
 └─────────────────────────────────────────────────────────────────────────────┘
```

应用代码无需使用零散的 JS Web API，统一使用 POSIX 文件操作（`open('/dev/ttyUSB0')`、`read()`、`write()`）进行硬件交互！

---

## 🌉 二、 绕过浏览器受限硬件的 3 大物理通道 Bridge

对于浏览器沙箱默认封锁的硬件（如物理 PCIe 卡、CAN 总线、GPIO 引脚、原生 Raw Socket 网卡）：

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         Earendel WebOS (Browser Space)                      │
 │      Application ──► open('/dev/can0') ──► driverd (VFS Device Driver)      │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ (WebSocket / WebRTC 物理隧道)
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                    Earendel Hardware Gateway Daemon                         │
 │      (宿主 Windows/Linux 1MB C/Go 本地硬件代理守护进程)                      │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ (Kernel Mode Ring 0 Direct I/O)
                                        ▼
                 [物理 CAN 总线 / PCIe 卡 / GPIO / Raw Net Card]
```

### 通道 1：`WebSocket / WebRTC Hardware Gateway Daemon`（物理网关通道）
- **适用场景**：纯 Web 浏览器环境访问物理单片机、GPIO、CAN 总线、原生 Socket；
- **机制**：在宿主 Windows/Linux 机器上运行一个仅 1MB 的 C/Go 硬件网关守护进程；
- **交互**：Earendel 的 `driverd` 驱动通过本地 WebSocket 隧道向网关发送 IPC 帧，网关代理完成宿主内核级的物理 Raw I/O 读写，彻底绕过浏览器受限！

### 通道 2：`Tauri / Electron Native Hardware Bridge`（桌面打包通道）
- **适用场景**：将 Earendel 打包为独立桌面客户端；
- **机制**：`driverd` 直接通过 Tauri Rust IPC 或 Electron C++ 原生 Addon，物理直连 Windows/Linux 的 Ring 0 驱动层。

### 通道 3：`WebAssembly Software Emulation`（软件虚拟化通道）
- **适用场景**：对于物理不存在的硬件（如 VT100 终端、声卡、虚拟网卡 TAP/TUN）；
- **机制**：通过 WASM 虚拟化引擎，在内存中进行寄存器级的软件仿真。

---

POSX 硬件抽象与硬件绕过通路全量解闭环！
