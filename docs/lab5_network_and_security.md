## 实验五：网络状态监测与主机安全防火墙配置

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]

> [!IMPORTANT]
> **环境说明**：Earendel 为沙盒教学系统，所有网络接口、路由、套接字与防火墙规则均运行于虚拟教学环境，不影响宿主机网络。UFW、iptables 与受限 nft 接口共用同一套防火墙规则模型。实验需以 root 身份执行相关管理命令。

---

### 实验目标

1. **掌握网络状态探测与排障工具**：熟练使用 `ip`, `ping`, `curl`, `nslookup` 进行网络接口查看、路由核查、连通性探测与域名解析。
2. **掌握端口与网络服务监控**：熟练使用 `ss`, `netstat` 监控系统套接字状态，结合服务管理器分析端口监听与对应服务。
3. **掌握主机防火墙配置与管理**：
   - 掌握高级防火墙工具 `ufw` 的规则配置、状态查询与默认策略控制；
   - 掌握底层包过滤工具 `iptables` 的规则链操作（查看、清空、策略设定、规则追加与插入）；
   - 理解 Linux 防火墙接口层级关系，掌握包过滤规则匹配顺序（首匹配原则）与主机安全加固策略。

---

### Part A：核心知识点解析与自由练习

---

#### 1. 网络配置与连通性测试

> [!NOTE]
> **预备理论**：网络运维与排障的基本工作流包括三个层面：确认本地网络接口与地址配置、测试网络层连通性与路由、诊断应用层网络服务是否正常响应。

##### (1) 查看网络接口与 IP 地址 (`ip addr`)
- 现代 Linux 发行版普遍采用 `ip` 命令族替代传统的 `net-tools` (`ifconfig`)。
- `ip addr` (简写 `ip a`)：查看本机网络接口、IP 地址及子网掩码配置。
  - `lo` (Loopback)：本地回环接口，地址固定为 `127.0.0.1`，用于本机内部进程间网络通信。
  - `eth0`：主网络接口，配置局域网或外部 IP 地址。
- `ip route` (简写 `ip r`)：查看内核路由表，确认默认网关（default gateway）与出接口。

##### (2) 连通性测试 (`ping`)
- `ping <目标IP或域名>`：发送 ICMP Echo 请求报文，测试与目标主机的网络层连通性并测算往返时延（RTT）。
- `ping -c <次数> <目标>`：指定发送报文数量，例如 `ping -c 4 8.8.8.8`。在 Linux 环境下未指定 `-c` 时默认持续发送，可按 `Ctrl + C` 中断。

##### (3) 应用层服务探测与 DNS 解析 (`curl` 与 `nslookup`)
- `curl <URL>`：发起 HTTP/HTTPS 请求以验证网络连通性与 Web 服务响应（当前支持基础 URL 请求，暂不支持 `-I` 等扩展选项）。
- `nslookup <域名>`：查询域名解析记录，解析优先匹配 `/etc/hosts` 及系统配置的 DNS 地址。

---

#### 2. 服务端口与连接状态监控 (`ss` / `netstat`)

网络服务（如 Web 服务器、SSH 守护进程）启动后，会在操作系统中监听特定的传输层端口（Port，范围 1~65535）。
- `ss -tuln`：查看当前处于监听状态的 TCP 与 UDP 套接字（现代 Linux 推荐使用 `ss`，执行效率高于 `netstat`）。
  - `-t`：仅显示 TCP 套接字。
  - `-u`：仅显示 UDP 套接字。
  - `-l`：仅显示处于监听状态（LISTEN）的套接字。
  - `-n`：以数字形式显示地址与端口，避免反向域名解析带来的延迟。
- `ss -tulnp`：增加 `-p` 参数显示占用该端口的进程名与 PID（通常需要 root 权限）。
- `netstat -tuln`：传统网络统计命令，输出格式与 `ss` 类似。

系统内置的关键服务及其默认端口包括：
- `sshd.service`：TCP 22（SSH 远程管理）
- `nginx.service`：TCP 80（HTTP Web 服务）
- `mysql.service`：TCP 3306（MySQL 数据库服务）

---

#### 3. Linux 主机防火墙机制与双管理接口

Linux 内核通过 Netfilter 框架实现数据包的过滤、网络地址转换（NAT）与状态跟踪。用户空间提供了不同抽象层级的管理工具：

> [!IMPORTANT]
> **接口支持说明**：
> 系统支持 **UFW** 与 **iptables** 管理接口，并提供 `nft` 的受限 filter 语法，三者统一映射至内部规则引擎。当前支持 IPv4 规则子集；暂不支持 `firewall-cmd`、IPv6、nft 集合及持久化 NAT 映射。

##### (1) 高级管理接口：UFW (Uncomplicated Firewall)
UFW 是 Ubuntu/Debian 体系中常用的前端工具，旨在简化 iptables 较为繁琐的命令语法：
- `ufw status` / `ufw status numbered`：查看启用状态、默认策略和规则；带编号的规则可供删除。
- `ufw enable` / `ufw disable`：启用或停用防火墙。
- `ufw default <allow|deny|reject> <incoming|outgoing|routed>`：设置 INPUT、OUTPUT 或 FORWARD 的默认策略。
- `ufw allow <端口>[/<协议>]`：放行指定端口，例如 `ufw allow 22/tcp`。
- `ufw deny from <IP地址>`：添加不限定端口的来源拒绝规则，协议为 `all`。
- `ufw insert 1 deny from <IP地址>`：将来源拒绝规则插入第一条，避免被后续宽泛的端口放行规则先匹配。
- `ufw delete <规则序号>`：按 `status numbered` 显示的当前序号删除规则；删除后序号会更新。
- `ufw reset`：重置所有防火墙规则并恢复默认策略。

演练规则顺序与首匹配行为推荐流程：
```sh
ufw reset
ufw default deny incoming
ufw insert 1 deny from 203.0.113.55
ufw allow 22/tcp
ufw allow 80/tcp
ufw enable
ufw status numbered
fwtest INPUT -p tcp --dport 80 -s 203.0.113.55
fwtest INPUT -p tcp --dport 80 -s 198.51.100.20
```
预期第一条 `fwtest` 返回 `DROP`，第二条返回 `ALLOW`。由此验证“首匹配”原则：精准拦截规则必须先于宽泛放行规则放置。注意 `ufw reset` 会重置所有防火墙规则，操作前需确认环境状态。

##### (2) 底层管理接口：IPTABLES
`iptables` 直接操作 INPUT、OUTPUT、FORWARD 链与规则：
- `iptables -L` / `iptables -L -n`：列出指定链或所有链的过滤规则。
- `iptables -S`：以可重放的命令形式列出链策略和规则。
- `iptables -F`：清空当前表（默认 `filter`）中所有链的规则。
- `iptables -P <链名> <ACCEPT|DROP>`：设置指定链的默认策略（Policy）。
- `iptables -A <链名> [匹配条件] -j <目标动作>`：在链末尾追加（Append）规则。
  - `-p <协议>`：指定协议，如 `tcp`, `udp`, `icmp`。
  - `--dport <端口>`：指定目标端口。
  - `-s <源IP/网段>`：指定源 IP 地址或 CIDR 网段。
  - `-j <动作>`：匹配后的动作，如 `ACCEPT`（放行）、`DROP`（丢弃）、`REJECT`（拒绝）。
- `iptables -I <链名> [匹配条件] -j <目标动作>`：在链首部插入（Insert）规则，优先匹配。
- 支持 `-t filter|nat|mangle|raw`、用户链 `-N/-X`、规则检查 `-C`、删除 `-D`、指定位置插入 `-I <链名> <序号>`，以及源/目的地址和端口匹配。
- 支持 `-m conntrack --ctstate NEW,ESTABLISHED,RELATED,INVALID`（兼容 `-m state --state`）进行连接状态匹配。HTTP 返回流量将作为反向 `ESTABLISHED` 包经过 INPUT 链。
- NAT 表支持 IPv4 `DNAT`、`SNAT`、`MASQUERADE` 规则；通过 `fwtest` 可直观观察地址与端口的改写效果。

NAT 规则示例：
```sh
iptables -t nat -A PREROUTING -p tcp --dport 8080 -j DNAT --to-destination 192.168.1.10:80
fwtest INPUT -p tcp --dport 8080 -s 203.0.113.22 -d 192.168.1.100
iptables -t nat -A POSTROUTING -s 192.168.1.0/24 -j MASQUERADE
fwtest OUTPUT -p tcp --dport 443 --sport 51000 -s 192.168.1.20 -d 203.0.113.10
```
第一条 `fwtest` 显示目的地址从 `192.168.1.100:8080` 改写为 `192.168.1.10:80`；第二条将源地址改写为出口地址 `192.168.1.100`。支持的 NAT 动作及链包括：DNAT（PREROUTING、OUTPUT）、SNAT（INPUT、POSTROUTING）、MASQUERADE（POSTROUTING）。

##### (3) nft 教学子集
系统提供 `nft` 命令的 filter 规则子集（暂不支持 NAT 表）：
```bash
nft list ruleset
nft add chain inet filter web_in '{ type filter hook input priority 0; policy drop; }'
nft add rule inet filter web_in tcp dport 80 accept
nft list chain inet filter web_in
# 将 HANDLE 替换为上条 list 输出中的编号
nft delete rule inet filter web_in handle HANDLE
fwtest INPUT -p tcp --dport 80 -s 203.0.113.55
```
支持 `inet` family、`filter` 表、INPUT/OUTPUT/FORWARD hook、整数 priority、TCP/UDP/ICMP 协议、IPv4 地址、端口、`ct state` 及动作判定。可通过 `nft list chain` 查看指定链，`nft insert rule ... position HANDLE` 在指定位置前插入规则，或根据 handle 序号删除规则。

`fwtest` 命令用于构造测试数据包以检验规则匹配结果，例如 `fwtest OUTPUT -p tcp --dport 443 -d 203.0.113.10 --ctstate NEW`。出站请求将经过 OUTPUT 规则，入站响应将匹配 INPUT 的 ESTABLISHED 规则，其余规则判定均可通过 `fwtest` 进行验证。

有状态过滤示例：
```bash
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -A OUTPUT -p tcp -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
iptables -A INPUT -p tcp -m conntrack --ctstate ESTABLISHED -j ACCEPT
```

##### (4) 规则匹配顺序与安全基线原则
- **首匹配原则（First-match）**：数据包遍历规则链时，按从上到下的顺序逐条匹配；一旦匹配到某条规则，立即执行该规则的动作并终止后续匹配。因此，具体的拦截规则通常应置于宽泛的放行规则之前。
- **默认拒绝原则**：生产环境通常将入站策略设为默认拒绝（Default DROP/DENY），仅显式开放业务所需的端口与受信任来源。

---

### Part B：任务挑战 —— 服务器网络审计与主机防火墙加固

#### 1. 业务场景
运维团队需对一台新部署的服务器进行网络环境核查与安全基线加固：
1. 审计系统当前的网络接口配置与对外监听端口。
2. 使用 `ufw` 接口配置基础安全策略：放行远程管理（22）与 Web 业务（80）端口，阻断存在异常访问行为的特定来源 IP。
3. 使用 `iptables` 底层接口检查规则映射，配置底层过滤策略并验证数据包过滤效果。
4. 整理并生成系统网络与安全审计报告文件 `~/net_audit.txt`。

---

#### 2. 挑战操作步骤

##### 步骤一：网络接口与路由状态检查
1. 查看系统网络接口与 IP 地址分配：
   ```bash
   ip addr
   ```
2. 查看内核路由表与网关配置：
   ```bash
   ip route
   ```

##### 步骤二：服务端口监听状态审计
1. 查看当前处于监听状态的 TCP 端口及对应服务进程：
   ```bash
   ss -tulnp
   ```
   *观察系统中 `sshd` (22), `nginx` (80), `mysql` (3306) 等服务的监听端口。*
2. 使用 `curl` 探测本地 Web 服务响应：
   ```bash
   curl https://example.com
   ```
   *(注：当前环境支持标准 URL 请求；若外部网络受限或连接失败，可记录状态并继续后续防火墙测试环节。)*

##### 步骤三：基于 UFW 实施防火墙基线配置
> [!NOTE]
> 在生产环境中，启用防火墙前必须确认远程管理端口策略以防连接中断。为实践“首匹配”原则，本实验先插入针对异常源的拦截规则，再配置通用端口放行规则。

1. 重置规则并将入站默认策略设为拒绝：
   ```bash
   ufw reset
   ufw default deny incoming
   ```
2. 把异常来源 IP（`203.0.113.55`）的拒绝规则放在规则首位，再放行 SSH 和 HTTP：
   ```bash
   ufw insert 1 deny from 203.0.113.55
   ufw allow 22/tcp
   ufw allow 80/tcp
   ```
3. 启用防火墙并查看规则顺序：
   ```bash
   ufw enable
   ufw status numbered
   ```
4. 验证异常来源被拦截、其他来源可访问 HTTP：
   ```bash
   fwtest INPUT -p tcp --dport 80 -s 203.0.113.55
   fwtest INPUT -p tcp --dport 80 -s 198.51.100.20
   ```
   预期判定（verdict）依次为 `DROP` 和 `ALLOW`，验证异常 IP 已被成功拦截，而受信任来源可正常通行。

##### 步骤四：基于 iptables 进行底层规则管理与过滤验证
1. 使用 `iptables` 查看当前 INPUT 链规则，观察 UFW 与 iptables 规则在底层的统一呈现：
   ```bash
   iptables -L INPUT
   ```
2. 使用 `-I` 参数向 INPUT 链首部插入一条针对特定来源 IP 的阻断规则：
   ```bash
   iptables -I INPUT -s 198.51.100.22 -j DROP
   ```
3. 验证数据包过滤联动效果：
   在 OUTPUT 链中添加一条 ICMP 阻断规则，测试出站报文过滤：
   ```bash
   iptables -A OUTPUT -p icmp -j DROP
   ```
   执行 `ping` 测试，观察内核包过滤拦截提示：
   ```bash
   ping -c 2 8.8.8.8
   ```
   *(预期输出提示 `Blocked by Firewall rules`，验证包过滤机制有效)*
4. 清除测试用 ICMP 阻断规则，恢复网络探测连通性：
   ```bash
   iptables -D OUTPUT -p icmp -j DROP
   ```

##### 步骤五：生成网络与安全加固审计报告 (`net_audit.txt`)
将本次网络状态审计与防火墙加固配置输出保存至报告文件：
```bash
# 1. 导出网络接口信息
echo "=== Network Interfaces ===" > ~/net_audit.txt
ip addr >> ~/net_audit.txt

# 2. 导出端口监听状态
echo -e "\n=== Listening Ports ===" >> ~/net_audit.txt
ss -tuln >> ~/net_audit.txt

# 3. 导出 UFW 防火墙状态与规则
echo -e "\n=== UFW Firewall Status ===" >> ~/net_audit.txt
ufw status numbered >> ~/net_audit.txt

# 4. 导出 iptables 规则配置
echo -e "\n=== IPTABLES Rules ===" >> ~/net_audit.txt
iptables -L INPUT >> ~/net_audit.txt

# 5. 追加实验学生信息
echo -e "\n=== Student Information ===" >> ~/net_audit.txt
echo "Student_ID: 20260001" >> ~/net_audit.txt
echo "Student_Name: ZhangSan" >> ~/net_audit.txt
```

---

### 实验交付与评分标准

#### 交付物
- 网络与安全审计报告文件：`~/net_audit.txt`

#### 评分标准（满分 100 分）
| 评分维度 | 分值 | 考察知识点 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **网络接口与端口审计** | 25分 | `ip addr`, `ss -tuln` | 正确获取网卡与 IP 配置，完整记录系统中监听的 TCP/UDP 端口及对应服务 |
| **UFW 防火墙策略配置** | 30分 | `ufw default/insert/allow/enable`, `fwtest` | 默认入站拒绝；异常来源规则先匹配；22/tcp 与 80/tcp 可从其他来源访问；防火墙处于 active 状态 |
| **IPTABLES 底层规则操作** | 25分 | `iptables -L/-I/-A/-F` | 掌握底层链规则查看、插入与清空操作，理解规则优先级与包过滤联动效果 |
| **审计报告规范性** | 20分 | 信息整理, 规范输出 | `~/net_audit.txt` 结构完整、格式整齐，准确包含接口、端口、两套防火墙规则输出及学生信息 |

---

### 思考与进阶拓展

1. **规则首匹配与优先级**：如果在一张防火墙规则表中先配置了 `allow from any to any port 80`，后配置了 `deny from 203.0.113.55`，被阻断的 IP 是否仍能访问 80 端口？为什么在管理防火墙时规则的顺序至关重要？
2. **防火墙接口抽象层级**：UFW 与 IPTABLES 之间是什么关系？在同一系统上混用这两套工具可能带来什么潜在问题？
3. **ICMP 过滤与网络安全**：为什么许多面向公网的服务器会配置防火墙策略丢弃（DROP）入站的 ICMP Echo 请求报文？这种做法具有哪些安全防护意义？
