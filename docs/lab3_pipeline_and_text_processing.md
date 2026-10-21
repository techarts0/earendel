## 实验三：数据流管道与文本处理工具 (Grep/Sed/Awk)

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]

---

### 实验目标

1. **掌握 I/O 重定向与文件描述符机制**：理解标准输入（STDIN, 0）、标准输出（STDOUT, 1）与标准错误（STDERR, 2）的概念，熟练运用 `>`, `>>`, `<`, `2>`, `2>&1` 控制数据流向。
2. **掌握 Linux 管道（Pipe）机制**：理解进程间标准流衔接原理，熟练使用 `|` 串联多个单功能命令，构建连续的数据处理流。
3. **掌握长文本查看与分页工具**：掌握 `cat`、`more`、`less` 的工作原理与适用场景，熟练使用 `less` 进行大文件浏览、关键词检索与快速跳转。
4. **熟练运用辅助文本处理与统计工具**：掌握 `head`, `tail`, `wc`, `cut`, `sort`, `uniq`, `tr`, `tee` 等命令进行文本切片、排序与频次去重统计。
5. **掌握常用文本处理工具（Grep / Sed / Awk）**：
   - **Grep**：掌握正则匹配、忽略大小写（`-i`）、行号显示（`-n`）、反向排除（`-v`）及计数统计（`-c`）；
   - **Sed**：掌握行流式编辑指令，包括打印（`p`）、行删除（`d`）以及正则替换（`s/old/new/g`）；
   - **Awk**：掌握列切分（`-F`）、内置变量（`$0`, `$1~$N`, `NF`, `NR`）、条件过滤与报表格式化输出。
6. **具备系统日志分析与统计能力**：能够综合运用管道与文本处理命令，对 Web 访问日志进行访问频次统计、异常请求筛选与数据脱敏。

---

### Part A：核心知识点解析与自由练习

---

#### 1. 输入输出重定向与文件描述符

Linux 进程启动时，操作系统默认分配三个标准 I/O 文件描述符：
```text
               ┌───────────────────────┐
键盘输入 ─────►│ 0: 标准输入 (STDIN)   │
               │                       │
               │      当前运行进程     │──────► 1: 标准输出 (STDOUT) ─────► 终端屏幕
               │                       │
               │                       │──────► 2: 标准错误 (STDERR) ─────► 终端屏幕
               └───────────────────────┘
```

| 符号 | 说明 | 功能与应用场景 | 示例 |
| :--- | :--- | :--- | :--- |
| `>` | 输出重定向（覆盖） | 将标准输出重定向到文件，覆盖文件原有内容 | `ls -l > filelist.txt` |
| `>>` | 输出重定向（追加） | 将标准输出追加至文件末尾，保留原有数据 | `echo "New Entry" >> app.log` |
| `<` | 输入重定向 | 指定文件作为命令的标准输入，替代键盘输入 | `wc -l < /etc/passwd` |
| `2>` | 错误重定向（覆盖） | 单独重定向进程的错误输出（STDERR）到文件 | `cat /etc/shadow 2> error.log` |
| `2>&1` | 描述符重定向合并 | 将标准错误输出合并至标准输出通道 | `cmd > all.log 2>&1` |

---

#### 2. 文本展示与分页查看工具对比 (`cat` vs `more` vs `less`)

| 工具 | 显示机制 | 翻页与定位能力 | 内存与性能特点 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **`cat`** | 一次性输出全部内容至终端 | 不支持交互式翻页，内容过多时会刷屏 | 一次性读取并输出 | 查看行数较少的文件（数十行以内） |
| **`more`** | 按屏幕逐页向下分页展示 | 仅支持向前翻页（空格翻页，回车逐行），回退受限 | 按屏逐步读取 | 基础分页浏览 |
| **`less`** | 按需加载的交互式分页器 | 支持向前向后平滑滚动、行号跳转与双向关键字检索 | 按需分页加载，大文件不占满内存 | 生产环境查看大日志或长文本 |

##### `less` 常用操作按键：
- `Space` / `PageDown`：向下翻动一屏；`PageUp`：向上翻动一屏
- `↓` / `↑` 方向键：向下 / 向上单行滚动
- `g` / `G`：快速跳转至文件首行 / 末行
- `/关键词`：向下检索关键词（按 `n` 查看下一处，`N` 查看上一处）
- `?关键词`：向上检索关键词
- `q`：退出 `less` 返回终端命令行

---

#### 3. 常用文本处理与统计工具清单

管道符 `|` 用于将**前一个命令的标准输出（STDOUT）**作为**后一个命令的标准输入（STDIN）**传递：

| 命令 | 常用核心选项 | 功能描述 | 示例 |
| :--- | :--- | :--- | :--- |
| `|` (管道) | 无 | 连接两个命令的标准输入输出 | `cat /etc/passwd \| wc -l` |
| `more` | `+<行号>` | 从指定行开始分页显示 | `more +10 /etc/passwd` |
| `less` | `-N` | 带行号的交互式分页浏览 | `less -N /var/log/syslog` |
| `head` / `tail` | `-n <行数>`, `-f` | 查看文本前 N 行或后 N 行（`-f` 实时追踪） | `head -n 5 log.txt` |
| `wc` | `-l`, `-w`, `-c` | 统计行数、单词数或字节数 | `wc -l access.log` |
| `sort` | `-n` (数值), `-r` (逆序), `-k <列>` | 按行或指定字段进行排序 | `sort -nr -k 2 data.txt` |
| `uniq` | `-c` (统计频次), `-d` (仅显示重复) | 去除或统计相邻连续重复行（**需先排序**） | `sort ip.txt \| uniq -c` |
| `cut` | `-d '<分隔符>' -f <列号>` | 按指定分隔符切分并提取特定列 | `cut -d ':' -f 1 /etc/passwd` |
| `tr` | `'[a-z]' '[A-Z]'`, `-d '<字符>'` | 字符映射替换或删除 | `echo "abc" \| tr 'a-z' 'A-Z'` |
| `tee` | `-a` (追加) | 双向输出：既输出至终端，同时写入文件 | `ls \| tee output.txt` |

---

#### 4. 文本处理三剑客（Grep / Sed / Awk）基础语法

##### (1) Grep：基于模式的行检索工具
- **语法**：`grep [选项] '匹配模式' 文件名`
- **常用选项**：
  - `-i`：忽略大小写差异
  - `-n`：输出结果附带原文件行号
  - `-v`：反向匹配（输出不包含匹配模式的行）
  - `-c`：输出匹配到的行数总计
  - `-E`：启用扩展正则表达式（支持 `+`, `?`, `|`, `()` 等元字符）
- **示例**：
  ```bash
  # 查找包含 root 的行并输出行号
  grep -n "root" /etc/passwd

  # 过滤掉所有以 '#' 开头的注释行与空白行
  grep -v "^#" /etc/login.defs | grep -v "^$"
  ```

##### (2) Sed：流式行编辑器
- **语法**：`sed [选项] '编辑指令' 文件名`
- **常用指令**：
  - `p`：输出匹配行（通常搭配 `-n` 参数抑制默认输出）
  - `d`：删除匹配行
  - `s/old/new/g`：全局替换匹配项
- **示例**：
  ```bash
  # 仅打印第 2 到第 5 行
  sed -n '2,5p' /etc/passwd

  # 将数据流中的 127.0.0.1 替换为 0.0.0.0
  echo "listen 127.0.0.1:80" | sed 's/127.0.0.1/0.0.0.0/g'

  # 删除所有包含 debug 的行
  sed '/debug/d' app.log
  ```

##### (3) Awk：按列切分与报表分析工具
- **语法**：`awk -F '<分隔符>' '{动作}' 文件名`
- **内置变量**：
  - `$0`：当前完整文本行
  - `$1`, `$2`, ... `$N`：切分后的第 1 列、第 2 列...
  - `NF`：当前行的字段总数（`$NF` 代表最后一列）
  - `NR`：当前处理记录的行号
- **示例**：
  ```bash
  # 以 ':' 为分隔符，提取用户名（第1列）与对应 Shell（最后一列）
  awk -F ':' '{print $1, $NF}' /etc/passwd

  # 筛选 UID（第3列）大于等于 1000 的普通用户
  awk -F ':' '$3 >= 1000 {print $1, $3}' /etc/passwd
  ```

---

#### 5. 常见流水线组合：Top N 频次统计模型

在日志分析与运维指标统计中，计算某字段出现频次最高的前 N 项属于通用组合：
```text
  提取字段列   ➔    排序     ➔   频次统计去重   ➔  按数值逆序排序 ➔ 截取前 N 行
awk / cut     |    sort    |     uniq -c     |    sort -nr     |   head -n N
```

---

### Part B：任务挑战 —— Web 服务访问日志分析与异常请求排查

#### 1. 业务场景
运维人员需对一台 Web 服务器的访问日志（`/var/log/nginx/access.log`）进行排查，分析近期出现的访问异常与潜在安全威胁：
1. 使用 `wc`、`head`、`tail` 与 `less` 掌握日志的总体规模与记录格式；
2. 检索日志中出现的疑似 SQL 注入特征与 404 扫描请求；
3. 统计请求频次最高的源 IP 地址（Top 3）；
4. 汇总 HTTP 响应状态码分布情况；
5. 对日志中的 IP 字段进行脱敏处理；
6. 导出日志安全审计报告文件 `~/traffic_audit.txt` 并签名。

---

#### 2. 操作步骤

##### 步骤一：准备初始访问日志数据
在终端中执行以下命令，在 `/var/log/nginx/access.log` 中生成测试日志：
```bash
sudo mkdir -p /var/log/nginx
cat << 'EOF' | sudo tee /var/log/nginx/access.log
192.168.1.105 - - [21/Sep/2026:02:10:01 +0800] "GET /index.html HTTP/1.1" 200 4521
10.0.2.15 - - [21/Sep/2026:02:10:05 +0800] "GET /api/user/profile HTTP/1.1" 200 1024
203.0.113.45 - - [21/Sep/2026:02:11:12 +0800] "GET /admin/login.php HTTP/1.1" 404 280
203.0.113.45 - - [21/Sep/2026:02:11:15 +0800] "GET /admin/db.sql HTTP/1.1" 404 280
198.51.100.88 - - [21/Sep/2026:02:12:00 +0800] "GET /api/goods?id=1' OR 1=1-- HTTP/1.1" 500 520
198.51.100.88 - - [21/Sep/2026:02:12:03 +0800] "GET /api/goods?id=2' UNION SELECT *-- HTTP/1.1" 500 520
198.51.100.88 - - [21/Sep/2026:02:12:08 +0800] "GET /api/goods?id=3' OR 'a'='a HTTP/1.1" 500 520
192.168.1.105 - - [21/Sep/2026:02:13:20 +0800] "POST /api/pay/order HTTP/1.1" 200 350
203.0.113.45 - - [21/Sep/2026:02:14:02 +0800] "GET /wp-login.php HTTP/1.1" 404 280
198.51.100.88 - - [21/Sep/2026:02:14:15 +0800] "GET /api/goods?id=4' OR 1=1-- HTTP/1.1" 500 520
192.0.2.200 - - [21/Sep/2026:02:15:30 +0800] "GET /static/logo.png HTTP/1.1" 304 0
203.0.113.45 - - [21/Sep/2026:02:16:10 +0800] "GET /shell.php HTTP/1.1" 404 280
10.0.2.15 - - [21/Sep/2026:02:16:45 +0800] "GET /api/dashboard HTTP/1.1" 200 2048
EOF
```

##### 步骤二：日志规模统计与交互式分页浏览 (`wc`, `head`, `tail`, `less`)
1. 统计日志记录总行数：
   ```bash
   wc -l /var/log/nginx/access.log
   ```
2. 查看日志首行与末行记录：
   ```bash
   head -n 2 /var/log/nginx/access.log
   tail -n 2 /var/log/nginx/access.log
   ```
3. 使用 `less -N /var/log/nginx/access.log` 打开日志：
   - 使用上下方向键或 `PageDown` / `PageUp` 浏览；
   - 输入 `/UNION` 按回车进行关键字定位；
   - 输入 `q` 退出。

##### 步骤三：异常请求检索 (`grep`)
1. 检索包含 SQL 注入关键字（如 `UNION` 或 `OR 1=1`）的请求行，并输出行号：
   ```bash
   grep -n -E "(OR 1=1|UNION SELECT)" /var/log/nginx/access.log
   ```
2. 统计响应状态码为 `404` 的请求出现次数：
   ```bash
   grep -c " 404 " /var/log/nginx/access.log
   ```

##### 步骤四：高频请求来源 IP 统计 Top 3 (`awk`, `sort`, `uniq`, `head`)
1. 提取日志第 1 列（源 IP），通过组合管道统计请求频次前 3 位的 IP 地址：
   ```bash
   awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head -n 3
   ```

##### 步骤五：HTTP 响应状态码分布统计 (`awk`, `sort`, `uniq`)
1. 提取日志第 9 列（HTTP 状态码），统计各状态码（如 200, 304, 404, 500）的出现频次：
   ```bash
   awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -nr
   ```

##### 步骤六：敏感字段脱敏处理 (`sed`)
1. 使用 `sed` 对日志前 5 行中的源 IP 地址末段进行脱敏替换（如 `198.51.100.88` 转换为 `198.51.100.*`）：
   ```bash
   head -n 5 /var/log/nginx/access.log | sed -E 's/([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.*/'
   ```

##### 步骤七：生成日志审计分析报告 (`traffic_audit.txt`)
将分析结果按格式重定向输出至报告文件：
```bash
# 1. 报告标题与请求总量
echo "=== Web Traffic Security Audit Report ===" > ~/traffic_audit.txt
echo -n "Total Request Count: " >> ~/traffic_audit.txt
wc -l /var/log/nginx/access.log | awk '{print $1}' >> ~/traffic_audit.txt

# 2. 写入检测到的异常 SQL 注入记录
echo -e "\n[Detected SQL Injection Patterns]:" >> ~/traffic_audit.txt
grep -E "(OR 1=1|UNION SELECT)" /var/log/nginx/access.log >> ~/traffic_audit.txt

# 3. 写入高频来源 IP Top 3
echo -e "\n[Top 3 IP Addresses by Request Count]:" >> ~/traffic_audit.txt
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head -n 3 >> ~/traffic_audit.txt

# 4. 写入 HTTP 状态码分布
echo -e "\n[HTTP Status Code Distribution]:" >> ~/traffic_audit.txt
awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -nr >> ~/traffic_audit.txt

# 5. 写入脱敏样例数据
echo -e "\n[Masked Log Sample (First 5 Lines)]:" >> ~/traffic_audit.txt
head -n 5 /var/log/nginx/access.log | sed -E 's/([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.*/' >> ~/traffic_audit.txt

# 6. 追加学生信息签名
echo -e "\n=== Student Information ===" >> ~/traffic_audit.txt
echo "Student_ID: 20260001" >> ~/traffic_audit.txt
echo "Student_Name: ZhangSan" >> ~/traffic_audit.txt
echo "Audit_Date: $(date +'%Y-%m-%d')" >> ~/traffic_audit.txt
echo "Audit_Status: VERIFIED" >> ~/traffic_audit.txt
```

---

### 实验交付与评分标准

#### 交付物
- Web 日志安全分析报告文件：`~/traffic_audit.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察命令 / 技能点 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **基础统计与分页查看** | 15分 | `wc -l`, `head`, `tail`, `less` | 正确统计日志总行数，首尾行提取准确，掌握 `less` 交互检索与退出操作 |
| **异常模式检索与过滤** | 25分 | `grep -E`, 正则过滤 | 准确检索并输出包含 `OR 1=1` 与 `UNION SELECT` 的异常记录，无遗漏 |
| **高频频次统计流水线** | 25分 | `awk`, `sort`, `uniq -c`, `head` | 正确组合管道，准确输出请求量前 3 的 IP 及其出现次数 |
| **状态码统计与数据脱敏**| 20分 | `awk '{print $9}'`, `sed` | 正确统计 200/404/500 等状态码分布，成功使用 `sed` 正则将 IP 末段脱敏为 `.*` |
| **审计报告规范性** | 15分 | 重定向, 格式化输出, 签名 | `traffic_audit.txt` 结构整洁、数据准确，包含完整分析结果与学生签名 |

---

### 思考与进阶拓展

1. **`cat`、`more` 与 `less` 的机制差异与选型**：在生产环境中查看数千兆字节（GB）的日志文件时，为何不宜直接执行 `cat` 命令？`less` 相比 `more` 具备哪些性能与交互优势？
2. **`uniq` 命令与前置排序的必要性**：为何在使用 `uniq` 统计或去重之前必须先经过 `sort` 处理？若直接对未经排序的文本运行 `uniq -c` 会产生何种结果？
3. **输出重定向符号的选用**：在自动化运维脚本中，覆盖重定向（`>`）与追加重定向（`>>`）在逻辑处理上有何区别？若将脚本中所有的 `>>` 误写为 `>`，将对最终日志生成带来何种后果？
