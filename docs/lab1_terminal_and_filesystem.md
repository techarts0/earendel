## 实验一：终端交互与文件系统管理

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]
- **辅助工具**：Earendel 命令行智能辅助 (`man agent` / `tutor`)

---

### 实验目标

1. **熟悉终端交互环境与命令语法**：掌握 Linux 命令行界面（CLI）的基本交互方式与标准语法格式（`命令 [选项] [参数]`）。
2. **掌握目录导航与文件系统结构**：理解 Linux 统一目录树与层次结构标准（FHS），熟练使用绝对路径、相对路径及特殊符号（`.`, `..`, `~`, `-`）。
3. **熟练操作文件与目录管理命令**：掌握文件的创建、查看、复制、移动、重命名、删除及元信息统计等基本操作。
4. **掌握基本信息检索与辅助诊断工具**：学会查阅手册（`man`），结合系统提供的命令行错误诊断功能进行语法纠错与自主排障。
5. **规范化组织工程目录与清单归档**：能够按照工程规范组织目录层级，完成文件分类归档与结构清单导出。

---

### Part A：核心知识点解析与自由练习

---

#### 1. 命令行语法与智能诊断辅助

> [!NOTE]
> **预备理论**：Linux 绝大多数命令遵循 `command [-options] [arguments]` 的通用格式。选项（Option）用于调节命令行为，参数（Argument）为命令的操作对象。

Earendel 提供了命令语法实时诊断与辅助提示功能，可在终端中查看或启用该功能：
```bash
# 查看智能辅助功能当前状态
man agent status

# 启用实时诊断与提示
man agent on
```

输入以下常见错误示例，观察系统给出的诊断反馈与语法纠错建议：
```bash
# 示例 1: 命令拼写错误（系统提示相近可用命令）
lss -la

# 示例 2: 不支持的选项参数（系统提示合法参数说明）
ls --wrong-arg

# 示例 3: 缺少必要参数（系统提示标准语法格式与示例）
cp /etc/hosts
```

---

#### 2. 文件系统常用命令清单

下表列出文件系统操作的核心命令，在进入任务操作前需在终端中逐项演练：

| 功能分类 | 命令 | 常用选项与参数 | 说明 | 示例 |
| :--- | :--- | :--- | :--- | :--- |
| **路径与导航** | `pwd` | 无 | 显示当前工作目录的绝对路径 | `pwd` |
| | `cd` | `~`, `/`, `..`, `-` | 切换工作目录（家目录 / 根目录 / 上级目录 / 前一次目录） | `cd /var/log` ➔ `cd -` |
| | `which` | 命令名 | 查找并显示可执行程序的绝对路径 | `which bash` / `which ls` |
| **内容查看** | `ls` | `-l`, `-a`, `-h`, `-R` | 列出目录内容（长格式 / 包含隐藏文件 / 易读单位 / 递归） | `ls -lah /etc` |
| | `tree` | `-L <深度>`, `-d` | 以树状结构展示目录层级 | `tree -L 2 /home` |
| | `cat` | `-n` | 输出文件全部内容（`-n` 显示行号） | `cat -n /etc/hosts` |
| | `head` / `tail` | `-n <行数>` | 输出文件前 N 行或后 N 行 | `head -n 5 /etc/passwd` |
| **创建管理** | `mkdir` | `-p` | 创建新目录（`-p` 递归创建多级目录） | `mkdir -p demo/sub/test` |
| | `touch` | 文件名 | 创建空文件或更新文件的时间戳 | `touch demo/app.py` |
| **移动与删除** | `cp` | `-r`, `-p` | 复制文件或目录（`-r` 递归复制，`-p` 保留属性） | `cp -r demo demo_bak` |
| | `mv` | 源路径 目标路径 | 移动文件/目录或重命名 | `mv demo_bak demo_v2` |
| | `rm` | `-r`, `-f` | 删除文件或目录（`-r` 递归删除，`-f` 强制删除） | `rm -rf demo_v2` |
| **查找与统计** | `find` | `-name`, `-type` | 根据文件名或类型检索文件 | `find / -name "*.conf"` |
| | `wc` | `-l`, `-w`, `-c` | 统计文件行数、单词数或字节数 | `wc -l /etc/passwd` |

---

### Part B：任务挑战 —— 工程目录规范化与文件归档整理

#### 1. 业务场景
在系统运维与项目部署过程中，管理员需对临时暂存区（`/tmp/project_staging`）内的配置、源码、脚本与日志文件进行规范化归类，建立标准工程目录结构，清理冗余临时文件，并导出最终的结构清单进行归档记录。

需完成以下任务：
1. 规划并建立符合通用规范的工程目录树；
2. 对暂存文件按类型分别迁移、重命名与副本备份；
3. 对关键配置文件进行内容核验与行数统计；
4. 清除暂存区残留的临时无用文件；
5. 导出工程目录树清单并追加学生签名。

---

#### 2. 操作步骤

##### 步骤一：准备初始文件暂存环境
在终端中执行以下命令，在 `/tmp/project_staging` 目录下生成待整理的文件集：
```bash
# 创建临时暂存区与子目录
mkdir -p /tmp/project_staging/legacy_dump
touch /tmp/project_staging/app.conf
touch /tmp/project_staging/db.conf.template
touch /tmp/project_staging/.env.production
touch /tmp/project_staging/server.py
touch /tmp/project_staging/deploy.sh
touch /tmp/project_staging/rollback.sh
touch /tmp/project_staging/access.log
touch /tmp/project_staging/system.log
touch /tmp/project_staging/junk.tmp
touch /tmp/project_staging/legacy_dump/old_core.dump
echo "Project Engine v1.0 - Production Ready" > /tmp/project_staging/RELEASE.md
echo -e "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8" > /tmp/project_staging/changelog.txt
```

##### 步骤二：创建标准化工程目录结构 (`mkdir -p`, `pwd`, `cd`)
1. 切换至当前用户的家目录并确认路径：
   ```bash
   cd ~
   pwd
   ```
2. 使用单条 `mkdir -p` 命令创建名为 `myproject` 的工程根目录及 4 个子目录：
   - `~/myproject/bin/`（存放执行脚本）
   - `~/myproject/conf/`（存放配置文件）
   - `~/myproject/src/`（存放程序源码）
   - `~/myproject/logs/`（存放日志文件）
   ```bash
   mkdir -p ~/myproject/{bin,conf,src,logs}
   ```

##### 步骤三：文件分类迁移与重命名 (`mv`, `cp`, `find`)
1. **配置管理**：
   - 将隐藏环境文件 `/tmp/project_staging/.env.production` 移动至 `~/myproject/conf/`；
   - 将配置文件 `/tmp/project_staging/app.conf` 移动至 `~/myproject/conf/`；
   - 将配置模板 `/tmp/project_staging/db.conf.template` 移动至 `~/myproject/conf/` 并重命名为 `db.conf`。
2. **源码与脚本归档**：
   - 将所有 `.sh` 脚本文件移动至 `~/myproject/bin/`；
   - 将 `server.py` 移动至 `~/myproject/src/`。
3. **日志归集**：
   - 将暂存区内的所有 `.log` 文件移动至 `~/myproject/logs/`。
4. **文档归档与副本复制**：
   - 将 `RELEASE.md` 复制至 `~/myproject/` 根目录下，保留源文件；
   - 创建 `~/myproject/docs/` 目录，并将 `changelog.txt` 复制至该目录中。

##### 步骤四：内容核验与命令路径确认 (`cat`, `head`, `tail`, `wc`, `which`)
1. 查看发布说明文件内容及行号：
   ```bash
   cat -n ~/myproject/RELEASE.md
   ```
2. 查看更新日志前 3 行内容：
   ```bash
   head -n 3 ~/myproject/docs/changelog.txt
   ```
3. 统计更新日志文件的总行数：
   ```bash
   wc -l ~/myproject/docs/changelog.txt
   ```
4. 确认系统当前使用的 Bash 解释器绝对路径：
   ```bash
   which bash
   ```

##### 步骤五：清理暂存区残留文件 (`rm`)
1. 删除暂存区中的临时文件 `/tmp/project_staging/junk.tmp`。
2. 递归删除遗留的无用转储目录 `/tmp/project_staging/legacy_dump/`。
3. 检查暂存区，确认无多余冗余文件：
   ```bash
   ls -la /tmp/project_staging
   ```

##### 步骤六：导出工程结构清单与签名归档 (`find`, `ls`)
1. 进入工程根目录：
   ```bash
   cd ~/myproject
   ```
2. 使用 `find` 命令导出当前工程目录的完整结构至 `project_manifest.txt`：
   ```bash
   find . > project_manifest.txt
   ```
3. 在清单末尾追加学生身份信息及解释器路径：
   ```bash
   echo "Student_ID: 20260001" >> project_manifest.txt
   echo "Student_Name: ZhangSan" >> project_manifest.txt
   echo "System_Shell: $(which bash)" >> project_manifest.txt
   ```

---

### 实验交付与评分标准

#### 交付物
- 工程目录结构清单文件：`~/myproject/project_manifest.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察命令 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **工程目录规范建立** | 20分 | `mkdir -p`, `pwd` | `bin`, `conf`, `src`, `logs`, `docs` 目录层级清晰，结构完整规范 |
| **配置文件归类与重命名** | 20分 | `mv`, `ls -a` | 正确迁移隐藏文件 `.env.production`，`db.conf.template` 规范重命名为 `db.conf` |
| **源码与文档分流备份** | 20分 | `cp`, `mv` | 脚本与源码归位准确；正确使用 `cp` 保留文档副本并建立 `docs` 目录 |
| **内容核查与冗余清理** | 20分 | `cat`, `head`, `wc`, `rm` | 正确执行行数统计与文件查看；彻底清理 `junk.tmp` 及 `legacy_dump` 目录 |
| **清单生成与信息签名** | 20分 | `find`, `which`, 重定向 | `project_manifest.txt` 结构完整，正确追加学号、姓名及 Shell 路径 |

---

### 思考与进阶拓展

1. **通配符与隐藏文件**：在 Linux 系统中，使用 `mv * /target/` 为何无法匹配并移动以 `.` 开头的隐藏文件？若需同时移动当前目录下包括隐藏文件在内的所有内容，应采用何种方法？
2. **高危删除命令的防范**：`rm -rf` 属于不可逆的高危命令。在实际运维工作中，通常可以通过哪些规范、别名机制或备份手段降低误删关键系统目录的风险？
