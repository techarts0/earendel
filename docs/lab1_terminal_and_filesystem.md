## 实验一：终端交互与文件系统

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]
- **辅助工具**：Earendel AI 智能助教 (`man agent` / `tutor`)

---

### 实验目标

1. 熟悉 Linux 命令行界面（CLI）的交互逻辑与基本语法结构（`命令 [选项] [参数]`）。
2. 熟练掌握文件系统导航、目录树结构、文件增删查改（CRUD）及元信息查看的核心指令。
3. 掌握相对路径、绝对路径、特殊路径符（`.`, `..`, `~`, `-`）及通配符（`*`, `?`）的灵活运用。
4. 学会利用内置手册（`man`）及 Earendel 实时 AI 智能助教（`man agent`）自主诊断与纠正命令行语法错误。
5. 能够综合运用所学指令，完成企业级工程工作区初始化、文件整理与交付清单生成。

---

### Part A：核心命令自由练习

> [!TIP]
> **自由探索说明**：本部分为无风险沙盒练习，请跟随引导在 Earendel 终端中逐条输入指令，观察输出并理解其参数含义。
> **智能助教(man agent)是 Earendel 独有的教学辅助功能，别的 Linux 发行版中没有。**

#### 1. 启动 AI 智能助教与自我纠错体验
在开始前，启用 Earendel 内置的实时错误诊断引擎：
```bash
# 查看智能助教当前状态
man agent status

# 启用实时智能助教
man agent on
```
**刻意报错测试**：故意输入一个错误的命令或拼写错误的参数，体验 AI 自动提示机制：
```bash
# 测试 1: 命令拼写错误（触发近邻命令推荐）
lss -la

# 测试 2: 选项参数错误（触发合法选项解释）
ls --wrong-arg

# 测试 3: 缺少操作数（触发命令标准用法示例）
cp /etc/hosts
```
*观察智能助教给出的纠错建议卡片，体验在后续练习中如何无需老师介入即可自主修正指令。*

---

#### 2. 文件系统必须掌握的命令清单

下表列出了本实验中**必须熟练练习并掌握**的 12 个基础命令。在进入 Part B 任务挑战前，请确保在终端中依次演练每条命令的用法：

| 分类 | 命令 | 常用选项与参数 | 功能描述 | 演练示例 |
| :--- | :--- | :--- | :--- | :--- |
| **导航定位** | `pwd` | 无 | 打印当前工作目录的绝对路径 | `pwd` |
| | `cd` | `~`, `/`, `..`, `-` | 切换工作目录（家目录/根目录/上级/上一次目录） | `cd /var/log` ➔ `cd -` |
| | `which` | 程序名 | 查找并显示可执行命令的绝对路径 | `which bash` / `which ls` |
| **查看展示** | `ls` | `-l`, `-a`, `-h`, `-R` | 列出目录内容（长格式/隐藏文件/人类易读/递归） | `ls -lah /etc` |
| | `tree` | `-L <深度>`, `-d` | 以树形图层次展示目录结构 | `tree -L 2 /home` |
| | `cat` | `-n` | 串联并输出文本文件全部内容（带行号） | `cat -n /etc/hosts` |
| | `head` / `tail` | `-n <行数>` | 输出文件前 N 行或末尾 N 行 | `head -n 5 /etc/passwd` |
| **创建管理** | `mkdir` | `-p` | 创建目录（`-p` 自动递归创建多级父目录） | `mkdir -p demo/sub/test` |
| | `touch` | 文件名 | 创建空白文件，或更新已有文件的时间戳 | `touch demo/app.py` |
| **变更清理** | `cp` | `-r`, `-p` | 复制文件或目录（`-r` 递归复制目录，`-p` 保留属性）| `cp -r demo demo_bak` |
| | `mv` | 源路径 目标路径 | 移动文件/目录，或对文件/目录重命名 | `mv demo_bak demo_v2` |
| | `rm` | `-r`, `-f` | 删除文件或目录（`-r` 递归删除，`-f` 强制不提示） | `rm -rf demo_v2` |
| **检索统计** | `find` | `-name`, `-type` | 在指定目录树中搜索匹配条件的文件或子目录 | `find / -name "*.conf"` |
| | `wc` | `-l`, `-w`, `-c` | 统计文件行数、字数或字节数 | `wc -l /etc/passwd` |

---

### Part B：任务挑战 —— 规范化工程空间与资产归档

#### 1. 业务背景
你作为实习系统管理员入职“阿波罗研发中心（Project Apollo）”。由于上周机房临时迁移，临时缓冲存储区（`/tmp/apollo_staging`）存放了一批混杂的项目初始配置文件、隐藏环境变量、业务代码、历史日志以及废弃垃圾。

研发主管要求你在今天下班前完成以下运维任务：
1. 搭建标准工程结构目录；
2. 对临时区内的各类资源分类归档，并清理冗余垃圾；
3. 核查文件行数与关键配置，最终输出系统工程索引清单并签名提交。

> **提示**：本任务挑战必须综合使用 Part A 表格中要求的全部核心命令！

---

#### 2. 挑战操作步骤

##### 步骤一：环境准备（生成待整理的混乱资产）
请在终端中执行以下批处理命令，模拟在 `/tmp/apollo_staging` 中构造的初始混杂文件：
```bash
# 构造临时缓冲测试区
mkdir -p /tmp/apollo_staging/legacy_dump
touch /tmp/apollo_staging/app.conf
touch /tmp/apollo_staging/db.conf.template
touch /tmp/apollo_staging/.env.production
touch /tmp/apollo_staging/server.py
touch /tmp/apollo_staging/deploy.sh
touch /tmp/apollo_staging/rollback.sh
touch /tmp/apollo_staging/access.log
touch /tmp/apollo_staging/system.log
touch /tmp/apollo_staging/junk.tmp
touch /tmp/apollo_staging/legacy_dump/old_core.dump
echo "Apollo Engine v1.0 - Production Ready" > /tmp/apollo_staging/RELEASE.md
echo -e "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8" > /tmp/apollo_staging/changelog.txt
```

##### 步骤二：搭建规范工程空间 (`mkdir -p`, `pwd`, `cd`)
1. 切换至你的用户家目录（`cd ~`），并使用 `pwd` 确认当前工作路径。
2. 使用一条单行 `mkdir -p` 指令，创建名为 `project-apollo` 的规范工作空间，其包含 4 个核心子目录：
   - `~/project-apollo/bin/`（脚本与执行文件）
   - `~/project-apollo/conf/`（系统与环境配置）
   - `~/project-apollo/src/`（程序源代码）
   - `~/project-apollo/logs/`（日志文件）

##### 步骤三：精准分类迁移与重命名 (`mv`, `cp`, `find`)
1. **隐藏环境配置与模板重命名**：
   - 将 `/tmp/apollo_staging/.env.production` 移动至 `~/project-apollo/conf/`。
   - 将 `/tmp/apollo_staging/app.conf` 移动至 `~/project-apollo/conf/`。
   - 将 `/tmp/apollo_staging/db.conf.template` 移动至 `~/project-apollo/conf/` 并同时**重命名**为 `db.conf`。
2. **脚本与代码归位**：
   - 将所有 `.sh` 脚本移动至 `~/project-apollo/bin/`。
   - 将 `server.py` 移动至 `~/project-apollo/src/`。
3. **日志归整**：
   - 使用 `find` 或通配符，将 `/tmp/apollo_staging/` 下所有的 `.log` 文件移动至 `~/project-apollo/logs/`。
4. **发布文档副本保留 (`cp -r`)**：
   - 将 `RELEASE.md` **复制（保留原临时文件）** 到 `~/project-apollo/` 根目录下。
   - 将 `changelog.txt` 复制到 `~/project-apollo/docs/`（若 `docs/` 不存在需先创建）。

##### 步骤四：内容校验与环境检查 (`cat`, `head`, `tail`, `wc`, `which`)
1. 使用 `cat -n ~/project-apollo/RELEASE.md` 查看发布说明内容及行号。
2. 使用 `head -n 3 ~/project-apollo/docs/changelog.txt` 查看变更记录前 3 行。
3. 使用 `wc -l ~/project-apollo/docs/changelog.txt` 查看该文件的总行数。
4. 使用 `which bash` 确认系统 Bash 解析器的绝对路径，为后续运维脚本做准备。

##### 步骤五：清理冗余与垃圾 (`rm -rf`, `rmdir`)
1. 删除临时测试区中的无用临时文件 `/tmp/apollo_staging/junk.tmp`。
2. 递归删除遗留的垃圾转储目录 `/tmp/apollo_staging/legacy_dump/`。
3. 使用 `ls -la /tmp/apollo_staging` 核对确认无多余垃圾文件滞留。

##### 步骤六：生成全景结构清单与作业提交签名 (`ls`, `tree`, `find`)
1. 进入工程根目录：`cd ~/project-apollo`。
2. 使用长格式列出全部文件与隐藏文件：`ls -laR`。
3. 若系统支持 `tree`，执行 `tree` 查看整体树状脉络。
4. 使用 `find . -print` 导出结构，重定向生成作业清单文件 `apollo_manifest.txt`：
   ```bash
   cd ~/project-apollo
   find . > apollo_manifest.txt
   ```
5. 在清单文件末尾追加你的学号、姓名以及刚才 `which bash` 查到的路径：
   ```bash
   echo "Student_ID: 20260001" >> apollo_manifest.txt
   echo "Student_Name: ZhangSan" >> apollo_manifest.txt
   echo "System_Shell: $(which bash)" >> apollo_manifest.txt
   ```

---

### 实验交付与评分标准

#### 交付物
- 最终生成的全景清单文件：`~/project-apollo/apollo_manifest.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察命令 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **工程目录骨架** | 20分 | `mkdir -p`, `pwd` | `bin`, `conf`, `src`, `logs`, `docs` 目录完备且层级正确 |
| **配置归类与重命名** | 20分 | `mv`, `ls -a` | 成功转移隐藏文件 `.env.production`，且 `db.conf.template` 规范改名为 `db.conf` |
| **代码/日志分流与保留**| 20分 | `cp`, `mv`, `find` | 脚本入 `bin/`、源码入 `src/`、日志入 `logs/`，`RELEASE.md` 正确使用 `cp` 保留副本 |
| **文件内容校验与清理** | 20分 | `cat`, `head`, `wc`, `rm` | 垃圾文件与 `legacy_dump` 彻底清除，掌握了 `head`/`wc` 等查看统计技能 |
| **清单生成与信息签名** | 20分 | `find`, `which`, 重定向 | `apollo_manifest.txt` 结构完整，尾部正确附加学号、姓名与 Shell 绝对路径 |
| **违规扣分项** | -10分 | — | 丢失重要文件、多级目录拼写错误或产生循环嵌套 |


> 请结合以上要求自行评分。
---


### 思考与进阶拓展
1. 在步骤三移动隐藏文件 `.env.production` 时，如果直接使用通配符 `mv * ~/project-apollo/conf/`，为什么隐藏文件不会被一并移动？应该如何匹配隐藏文件？
2. `rm -rf` 是一条极其危险的高危指令。在日常生产运维中，有什么好的工程习惯或替代方案可以降低误删系统关键目录的风险？
