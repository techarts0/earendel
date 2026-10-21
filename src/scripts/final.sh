#!/bin/bash
# Apollo 教学实验：EAF 构建、服务账户权限、日志分析与模拟防火墙联动。
# 本脚本只操作 Earendel 虚拟文件系统和模拟防火墙，不修改宿主机。

if [ "$(id -u)" != "0" ]; then
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

# 创建虚拟文件系统中默认不存在的 /data，并准备所有后续目录。
mkdir -p "$APP_DIR" "$LOG_DIR" || fail "无法创建实验目录；请检查 VFS 路径和 root 会话。"

# 组必须先于用户创建；重复运行时修正现有用户的主组。
if ! grep -q "^${APP_GROUP}:" /etc/group; then
  groupadd "$APP_GROUP" || fail "无法创建组 $APP_GROUP。"
fi
if grep -q "^${APP_USER}:" /etc/passwd; then
  usermod -g "$APP_GROUP" "$APP_USER" || fail "无法将 $APP_USER 的主组设置为 $APP_GROUP。"
else
  useradd -m -g "$APP_GROUP" "$APP_USER" || fail "无法创建服务用户 $APP_USER。"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR" || fail "无法设置应用目录属主。"
chmod 770 "$APP_DIR" || fail "无法设置应用目录权限。"
chown "$APP_USER:$APP_GROUP" "$LOG_DIR" || fail "无法设置日志目录属主。"
chmod 750 "$LOG_DIR" || fail "无法设置日志目录权限。"

# 生成一次性健康检查程序。Earendel 当前 EAF 执行模型会运行程序并返回，
# 因此本实验不把它描述为常驻 daemon。
if [ ! -f "$SERVER_JS" ]; then
  echo "const serviceName = 'ApolloNodeService';" > "$SERVER_JS" || fail "无法创建服务源码。"
  echo "console.log('[Heartbeat] ' + serviceName + ' health check passed.');" >> "$SERVER_JS" || fail "无法写入服务源码。"
fi
chown "$APP_USER:$APP_GROUP" "$SERVER_JS" || fail "无法设置源码属主。"

echo "[1/5] 编译 EAF 健康检查程序..."
ecc "$SERVER_JS" -O2 -s -o "$SERVER_EAF" || fail "ECC 编译失败。"
chown "$APP_USER:$APP_GROUP" "$SERVER_EAF" || fail "无法设置 EAF 属主。"
chmod 750 "$SERVER_EAF" || fail "无法设置 EAF 执行权限。"

# root 通过 su -c 无密码地以服务账户执行单条命令；日志重定向由 root shell 完成。
su "$APP_USER" -c "$SERVER_EAF" > "$APP_LOG" || fail "服务账户 EAF 健康检查失败。"
echo "[2/5] EAF 已由 $APP_USER 执行；输出记录在 $APP_LOG。"

# 只在首次运行时创建教学样例日志，后续保留学生修改过的数据。
if [ ! -f "$ACCESS_LOG" ]; then
  echo '192.168.1.10 - - [20/Oct/2026:10:00:01] "GET /index.html HTTP/1.1" 200 1024' > "$ACCESS_LOG" || fail "无法初始化访问日志。"
  echo '203.0.113.195 - - [20/Oct/2026:10:00:05] "GET /admin/db.sql HTTP/1.1" 404 280' >> "$ACCESS_LOG" || fail "无法写入访问日志。"
  echo '203.0.113.195 - - [20/Oct/2026:10:00:07] "GET /wp-login.php HTTP/1.1" 404 280' >> "$ACCESS_LOG" || fail "无法写入访问日志。"
  echo '10.0.0.5 - - [20/Oct/2026:10:00:10] "GET /api/status HTTP/1.1" 200 512' >> "$ACCESS_LOG" || fail "无法写入访问日志。"
  echo '203.0.113.195 - - [20/Oct/2026:10:00:15] "GET /shell.php HTTP/1.1" 404 280' >> "$ACCESS_LOG" || fail "无法写入访问日志。"
  echo '198.51.100.77 - - [20/Oct/2026:10:00:20] "GET /api/test HTTP/1.1" 404 280' >> "$ACCESS_LOG" || fail "无法写入访问日志。"
fi

# 分析最高频 404 来源；黑名单保存在固定应用目录，不受当前工作目录影响。
TOP_BAD_IP=$(grep " 404 " "$ACCESS_LOG" | awk '{print $1}' | sort | uniq -c | sort -nr | head -n 1 | awk '{print $2}')
touch "$BLACKLIST_FILE" || fail "无法创建黑名单文件。"
if [ -n "$TOP_BAD_IP" ] && ! grep -q "^${TOP_BAD_IP}$" "$BLACKLIST_FILE"; then
  echo "$TOP_BAD_IP" >> "$BLACKLIST_FILE" || fail "无法更新黑名单。"
  echo "[3/5] 发现高频 404 来源：$TOP_BAD_IP。"
else
  echo "[3/5] 没有新的高频 404 来源需要记录。"
fi

# UFW 是 Earendel 中的模拟防火墙。先重建本实验拥有的规则集，确保重复运行不累积规则。
ufw reset || fail "无法重置模拟防火墙规则。"
if [ -s "$BLACKLIST_FILE" ]; then
  for ip in $(cat "$BLACKLIST_FILE"); do
    ufw insert 1 deny from "$ip" || fail "无法添加来源拦截规则：$ip。"
  done
fi
ufw allow 22/tcp || fail "无法添加 SSH 教学规则。"
ufw allow 9090/tcp || fail "无法添加业务端口教学规则。"
ufw enable || fail "无法启用模拟防火墙。"
echo "[4/5] 模拟防火墙规则已重建并启用。"

# 汇总的是 Earendel 虚拟系统状态，不代表宿主机服务或真实网络规则。
echo "==================================================" > "$STATUS_REPORT" || fail "无法创建状态报告。"
echo "Apollo 教学实验状态快照" >> "$STATUS_REPORT"
echo "快照时间：$(date)" >> "$STATUS_REPORT"
echo "服务账户：$(id "$APP_USER")" >> "$STATUS_REPORT"
echo "EAF 健康检查：已执行（一次性前台任务）" >> "$STATUS_REPORT"
echo "应用日志：$APP_LOG" >> "$STATUS_REPORT"
echo "--- Earendel 模拟进程表 ---" >> "$STATUS_REPORT"
ps aux >> "$STATUS_REPORT" || fail "无法读取模拟进程表。"
echo "--- Earendel 模拟防火墙规则 ---" >> "$STATUS_REPORT"
ufw status numbered >> "$STATUS_REPORT" || fail "无法读取模拟防火墙状态。"
echo "--- 学生签名 ---" >> "$STATUS_REPORT"
echo "Student_ID   : 20260001" >> "$STATUS_REPORT"
echo "Student_Name : ZhangSan" >> "$STATUS_REPORT"
echo "Audit_Verdict: SIMULATED_CHECKS_COMPLETED" >> "$STATUS_REPORT"
echo "==================================================" >> "$STATUS_REPORT"
echo "[5/5] 实验完成；状态报告：$STATUS_REPORT"
cat "$STATUS_REPORT"
