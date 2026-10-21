# 期末综合实验：Apollo 节点部署与安全分析自动化

- **适用课程**：Linux 操作系统
- **推荐学时**：6 学时（第 7 至第 8 周）
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]
- **考核性质**：期末综合设计

---

## 一、实验要求

综合运用本学期所学的 Linux 核心技能，编写并调试 Shell 自动化运维脚本，完成目录及账户初始化、权限配置、ECC 编译构建、EAF 进程执行、Web 访问日志审计、UFW 防火墙策略配置以及系统状态快照生成。

请将下方的参考脚本复制到系统指定路径中。脚本已包含完整的业务流程骨架，需补全 4 处缺失的核心命令名，并定位修复预设的 3 处故障逻辑；无需从头重写整套脚本。

---

## 二、实验准备与运行步骤

1. **创建脚本文件**：以普通用户身份创建 `/home/hello/script.sh`，将文末参考脚本保存至该文件。
2. **设置执行权限**：执行 `chmod +x /home/hello/script.sh`。
3. **权限验证测试**：先以普通用户身份运行一次，确认脚本能正确识别非 root 权限、输出拦截错误提示并以非零状态安全退出，未残留任何未授权操作。
4. **管理权限执行**：切换至 root 账户登录，正式执行 `/home/hello/script.sh`。
5. **幂等性测试**：重复多次运行脚本，检查账户、文件权限、黑名单及防火墙规则保持稳定无重复累积，并核查 `/var/log/apollo/node_status.txt` 报告内容。
6. **环境规范注意**：本脚本包含防火墙规则重置与端口安全配置，专用于 Earendel 教学实验平台，切勿直接在宿主机生产环境中运行。

---

## 三、核心任务与技术规范

### 任务一：权限前置检查与系统基线初始化
- **特权检测**：在脚本开头使用 `id -u` 检查执行者 UID。非 root 用户（UID ≠ 0）执行时必须输出明确提示并终止退出（Exit Code 1），杜绝非特权用户创建残缺目录。
- **目录准备**：创建应用核心目录 `/data/apollo_core` 与日志归档目录 `/var/log/apollo`，确认目录准备就绪后再流转至后续操作。
- **账户与工作组**：检测并创建 `apollo_team` 组与 `apollo_svc` 服务用户；若账户已存在，自动校验并将其主组修正为 `apollo_team`。
- **权限隔离**：将 `/data/apollo_core` 属主与属组设置为 `apollo_svc:apollo_team`、权限设置为严格的 `770`；同时将日志归档目录访问权授予该服务账户。

### 任务二：ECC 源码构建与服务健康检查
- **源码准备**：若微服务源码 `/data/apollo_core/server.js` 不存在，自动生成 Apollo 节点健康检查源码。
- **编译打包**：调用系统内置编译器执行 `ecc "$SERVER_JS" -O2 -s -o "$SERVER_EAF"` 完成构建，严格检查编译器退出状态（`|| fail`）。
- **权限与归属**：将生成的 `server.eaf` 属主设定为 `apollo_svc:apollo_team`，授予对应的执行权限。
- **降权执行**：通过 `su "$APP_USER" -c "$SERVER_EAF"` 切换至服务账户执行 EAF 健康检查程序（root 以 `su -c` 切换账户执行无需输入密码，执行完毕后自动恢复上下文环境），并将程序标准输出保存至 `/var/log/apollo/app.log`。

### 任务三：访问日志审计与黑名单动态提取
- **日志数据**：若日志文件 `/var/log/apollo/web_access.log` 不存在，自动初始化测试访问日志（包含正常访问与多条 404 状态记录）；若已存在则直接复用，禁止覆写已有数据。
- **分析流水线**：组合使用文本流处理工具（`grep`, `awk`, `sort`, `uniq`, `head`），精准提取 404 错误出现频次最高的异常源 IP。
- **黑名单持久化**：将提取结果保存至绝对路径 `/data/apollo_core/blacklist.txt`（严禁使用 `$(pwd)` 相对路径，避免执行目录变化引起文件位置漂移）。
- **去重校验**：追加记录前进行去重校验，保证重复执行时同一 IP 不重复记录。

### 任务四：主机防火墙基线与异常封堵
- **规则重置与基线配置**：调用 `ufw reset` 清除旧规则；按“首匹配”原则先将黑名单中的来源 IP 置顶拦截（`ufw insert 1 deny from <IP>`），再添加 `22/tcp`（SSH）与 `9090/tcp`（业务）放行规则，最后启用防火墙并输出规则列表。
- **健壮性保障**：对各条防火墙配置命令的执行状态进行校验，严禁在命令执行报错时仍输出“配置成功”。
- **工程安全考量**：理解黑名单拦截在生产环境中的工程边界（真实生产中需审慎核验候选 IP，防范 NAT 共享出口、合法搜索引擎爬虫等带来的误封风险）。

### 任务五：导出系统状态快照报告
自动生成节点综合状态审计报告 `/var/log/apollo/node_status.txt`，内容包括：
- 报告生成时间戳；
- 服务账户 `apollo_svc` 的 UID/GID 及主组配置；
- EAF 健康检查执行记录与应用日志路径；
- 系统的当前进程列表（`ps aux`）；
- 防火墙生效规则列表（`ufw status numbered`）；
- 学生身份签名（学号、姓名）与状态审计结论。

---

## 四、参考脚本（待补全与故障排查）

先将脚本保存为 `/home/hello/script.sh`。填空处只填写命令名，保留后面的参数。然后检查并修复脚本中设置的 3 处故障。建议先静态检查，再运行调试。

```bash
#!/bin/bash

# 故障之一：检查判断写错了。先检查这里，确保只有 root 才继续。
if [ "$(id -u)" = "0" ]; then
  echo "错误：本实验需要 root 权限。请先登录 root，再重新运行脚本。" >&2
  exit 1
fi

APP_DIR="/data/apollo_core"
LOG_DIR="/var/log/apollo"
SERVER_JS="$APP_DIR/server.js"
SERVER_EAF="$APP_DIR/server.eaf"
APP_LOG="$LOG_DIR/app.log"
ACCESS_LOG="$LOG_DIR/web_access.log"
BLACKLIST_FILE="$APP_DIR/blacklist.txt"
STATUS_REPORT="$LOG_DIR/node_status.txt"
APP_USER="apollo_svc"
APP_GROUP="apollo_team"

fail() {
  echo "错误：$1" >&2
  exit 1
}

echo "=== Apollo 节点部署与安全联动实验 ==="

# 填空 1：补充创建目录的命令名，参数已经给出。
________ -p "$APP_DIR" "$LOG_DIR" || fail "无法创建实验目录。"

if ! grep -q "^${APP_GROUP}:" /etc/group; then
  groupadd "$APP_GROUP" || fail "无法创建组 $APP_GROUP。"
fi
if grep -q "^${APP_USER}:" /etc/passwd; then
  usermod -g "$APP_GROUP" "$APP_USER" || fail "无法修正服务用户主组。"
else
  # 填空 2：补充创建用户的命令名，参数已经给出。
  ________ -m -g "$APP_GROUP" "$APP_USER" || fail "无法创建服务用户。"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR" || fail "无法设置应用目录属主。"
# 填空 3：补充设置权限的命令名，参数已经给出。
________ 770 "$APP_DIR" || fail "无法设置应用目录权限。"
chown "$APP_USER:$APP_GROUP" "$LOG_DIR" || fail "无法设置日志目录属主。"

if [ ! -f "$SERVER_JS" ]; then
  echo "const serviceName = 'ApolloNodeService';" > "$SERVER_JS" || fail "无法创建服务源码。"
  echo "console.log('[Heartbeat] ' + serviceName + ' health check passed.');" >> "$SERVER_JS" || fail "无法写入服务源码。"
fi
chown "$APP_USER:$APP_GROUP" "$SERVER_JS" || fail "无法设置源码属主。"

echo "[1/5] 编译 EAF 健康检查程序..."
# 故障之二：输出文件路径与后面使用的 SERVER_EAF 不一致，请排查 -o 参数。
ecc "$SERVER_JS" -O2 -s -o "$APP_DIR/health.eaf" || fail "ECC 编译失败。"
chown "$APP_USER:$APP_GROUP" "$SERVER_EAF" || fail "无法设置 EAF 属主。"
# 填空 4：一次设置日志目录和 EAF 的权限，补充命令名即可。
________ 750 "$LOG_DIR" "$SERVER_EAF" || fail "无法设置日志目录或 EAF 权限。"

su "$APP_USER" -c "$SERVER_EAF" > "$APP_LOG" || fail "服务账户 EAF 健康检查失败。"
echo "[2/5] EAF 已由 $APP_USER 执行；输出记录在 $APP_LOG。"

if [ ! -f "$ACCESS_LOG" ]; then
  echo '192.168.1.10 - - [20/Oct/2026:10:00:01] "GET /index.html HTTP/1.1" 200 1024' > "$ACCESS_LOG"
  echo '203.0.113.195 - - [20/Oct/2026:10:00:05] "GET /admin/db.sql HTTP/1.1" 404 280' >> "$ACCESS_LOG"
  echo '203.0.113.195 - - [20/Oct/2026:10:00:07] "GET /wp-login.php HTTP/1.1" 404 280' >> "$ACCESS_LOG"
  echo '10.0.0.5 - - [20/Oct/2026:10:00:10] "GET /api/status HTTP/1.1" 200 512' >> "$ACCESS_LOG"
  echo '203.0.113.195 - - [20/Oct/2026:10:00:15] "GET /shell.php HTTP/1.1" 404 280' >> "$ACCESS_LOG"
  echo '198.51.100.77 - - [20/Oct/2026:10:00:20] "GET /api/test HTTP/1.1" 404 280' >> "$ACCESS_LOG"
fi

TOP_BAD_IP=$(grep " 404 " "$ACCESS_LOG" | awk '{print $1}' | sort | uniq -c | sort -nr | head -n 1 | awk '{print $2}')
touch "$BLACKLIST_FILE" || fail "无法创建黑名单文件。"
if [ -n "$TOP_BAD_IP" ] && ! grep -q "^${TOP_BAD_IP}$" "$BLACKLIST_FILE"; then
  echo "$TOP_BAD_IP" >> "$BLACKLIST_FILE" || fail "无法更新黑名单。"
  echo "[3/5] 发现高频 404 来源：$TOP_BAD_IP。"
else
  echo "[3/5] 没有新的高频 404 来源需要记录。"
fi

ufw reset || fail "无法重置防火墙规则。"
if [ -s "$BLACKLIST_FILE" ]; then
  for ip in $(cat "$BLACKLIST_FILE"); do
    # 故障之三：检查来源 IP 拒绝规则的 UFW 命令语法。
    ufw deny "$ip" || fail "无法添加来源拦截规则：$ip。"
  done
fi
ufw allow 22/tcp || fail "无法添加 SSH 规则。"
ufw allow 9090/tcp || fail "无法添加业务端口规则。"
ufw enable || fail "无法启用防火墙。"
echo "[4/5] 防火墙规则已重建并启用。"

echo "==================================================" > "$STATUS_REPORT" || fail "无法创建状态报告。"
echo "Apollo 实验状态快照" >> "$STATUS_REPORT"
echo "快照时间：$(date)" >> "$STATUS_REPORT"
echo "服务账户：$(id "$APP_USER")" >> "$STATUS_REPORT"
echo "EAF 健康检查：已执行（一次性前台任务）" >> "$STATUS_REPORT"
echo "应用日志：$APP_LOG" >> "$STATUS_REPORT"
echo "--- Earendel 进程表 ---" >> "$STATUS_REPORT"
ps aux >> "$STATUS_REPORT" || fail "无法读取进程表。"
echo "--- Earendel 防火墙规则 ---" >> "$STATUS_REPORT"
ufw status numbered >> "$STATUS_REPORT" || fail "无法读取防火墙状态。"
echo "--- 学生签名 ---" >> "$STATUS_REPORT"
echo "Student_ID   : 20260001" >> "$STATUS_REPORT"
echo "Student_Name : ZhangSan" >> "$STATUS_REPORT"
echo "Audit_Verdict: SIMULATED_CHECKS_COMPLETED" >> "$STATUS_REPORT"
echo "==================================================" >> "$STATUS_REPORT"
echo "[5/5] 实验完成；状态报告：$STATUS_REPORT"
cat "$STATUS_REPORT"
```

---

## 五、实验交付要求

1. **完整脚本文件**：`script.sh`（补全命令并修复 3 处故障后的可执行 Shell 脚本）；
2. **运行输出结果**：`result.txt`（脚本成功执行后的完整终端输出，或 `/var/log/apollo/node_status.txt` 快照内容）；

请将上述两个文件打包压缩，文件命名为：`学号_姓名.zip`，提交给课程学习委员统一汇总。

> [!NOTE]
> 本实验为期末综合设计考核，直接计入期末总评成绩，请同学们独立认真完成。
