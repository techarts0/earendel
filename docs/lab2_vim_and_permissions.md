## 实验二：VIM 编辑器与多用户权限

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]


---

### 实验目标

1. **学会 VIM 核心编辑技能**：理解 VIM 的三种核心模式（正常命令模式、插入编辑模式、末行/底行命令模式）的工作原理与切换逻辑，告别“不会退出、乱码误删”的困境。
2. **形成键盘肌肉记忆**：熟练掌握光标快速跳转、文本复制/粘贴（`yy`/`p`）、行删除/剪切（`dd`）、撤销与重做（`u`/`Ctrl+r`）、末行全局正则替换（`:%s`）以及安全保存退出（`:wq` / `:q!`）。
3. **系统掌握用户与组管理**：深入理解 `/etc/passwd`、`/etc/shadow`、`/etc/group` 结构，熟练运用 `useradd`、`usermod`、`userdel`、`groupadd`、`passwd`、`id`、`su`、`sudo` 进行多用户账号生命周期治理。
4. **理解 POSIX 文件权限模型**：深刻理解文件权限位（`-rwxr-xr--`）构成，分清读（r）、写（w）、执行（x）在“普通文件”与“目录”上的本质区别。
5. **掌握权限与归属管控艺术**：熟练运用八进制数值法（755、644、700）与符号运算法（`u+x`, `g-w`, `o=r`），熟练使用 `chmod`、`chown`、`chgrp` 落地生产最小特权安全基线。

---

### Part A：核心知识点解析与自由练习

---

#### 1. 理论精讲：Linux 文件权限与所有权模型（预备知识）

> [!NOTE]
> **预备理论**：在 Linux 系统中，一切皆文件。每一个文件和目录都严格绑定了“谁拥有它（所有者与所属组）”以及“谁能对它做什么（读/写/执行权限）”。

##### (1) 权限属性字符串拆解（10 个字符）
执行 `ls -l` 时，每行开头展示的 10 位字符决定了该资源的生杀大权：
```text
  -  r w x  r - x  r - -
  ┬  ─────  ─────  ─────
  │    │      │      │
  │    │      │      └── 4. Other 权限：其他任何人（既非属主，也不在属组）的权限
  │    │      └──────── 3. Group 权限：文件所属用户组的成员拥有的权限
  │    └────────────── 2. User 权限：文件所有者（属主）独享的权限
  └────────────────── 1. 类型标识：'-' 代表普通文件，'d' 代表目录，'l' 代表软链接
```

##### (2) 权限位（r, w, x）在“文件”与“目录”上的核心区别（高频考点）

| 权限符号 | 对应数值 | 对**普通文件**的含义 | 对**目录**的含义（关键易错点！） |
| :---: | :---: | :--- | :--- |
| **`r`** (Read) | **4** | 可查看文件内容（如 `cat`, `more`） | 可列出目录下的内容文件名（如 `ls` 查看文件名列表） |
| **`w`** (Write)| **2** | 可修改或覆盖文件内容（如 `vim` 保存） | 可在该目录下**新建、删除、重命名**文件（决定文件生死的权力） |
| **`x`** (eXecute)| **1** | 可作为程序或脚本执行（如 `./run.sh`）| 可**进入**该目录（如 `cd` 进去）并访问内部文件的元数据 |

> [!WARNING]
> **陷阱警示**：如果对一个目录只有 `r` 权限而没有 `x` 权限，你能看到目录里有哪些文件名，但**绝对无法 `cd` 进去**，也无法读取里面文件的详细内容！

##### (3) 权限计算与八进制对照表
权限使用二进制求和，每组 3 位取值范围为 `0 ~ 7`：
- `rwx` = 4 + 2 + 1 = **7**（完全控制）
- `rw-` = 4 + 2 + 0 = **6**（可读可写，通常用于配置文件与文档）
- `r-x` = 4 + 0 + 1 = **5**（可读可执行/可进入，通常用于脚本与目录）
- `r--` = 4 + 0 + 0 = **4**（只读）
- `---` = 0 + 0 + 0 = **0**（无任何权限）

---

#### 2. 权限与所有权管控命令详析 (`chmod`, `chown`, `chgrp`)

##### (1) `chmod`：修改权限（Change Mode）
`chmod` 支持两种修改方式：
- **八进制数值法**（生产环境最常用、最快捷）：
  ```bash
  chmod 755 run.sh       # 属主 rwx(7)，属组 r-x(5)，其他人 r-x(5)
  chmod 644 config.conf  # 属主 rw-(6)，属组 r--(4)，其他人 r--(4)
  chmod 700 private_dir  # 仅属主拥有全部权限，其余人完全隔离
  ```
- **符号运算法**（适用于只想增减某项权限，不破坏原有其它权限）：
  - 对象：`u` (User 属主), `g` (Group 属组), `o` (Other 其他人), `a` (All 所有人)
  - 操作：`+` (赋予), `-` (收回), `=` (强制赋予且清除其他)
  ```bash
  chmod +x build.sh       # 为所有人增加可执行权限
  chmod g+w shared_doc    # 为所属组成员增加写权限
  chmod o-r secret.txt    # 移除外界其他人的读权限
  chmod u=rwx,go=r file   # 属主全权，组和其他人只读
  ```

##### (2) `chown` 与 `chgrp`：修改归属所有者与所属组
- `chown`（Change Owner）：既可改属主，也可同时改属组：
  ```bash
  chown alice file.txt          # 仅将属主改为 alice
  chown alice:developers dir    # 将属主改为 alice，属组改为 developers
  chown -R alice:developers dir # -R 递归修改目录下所有子文件和子目录
  ```
- `chgrp`（Change Group）：专门修改文件所属组：
  ```bash
  chgrp developers project/     # 将 project 目录的属组改为 developers
  ```

---

#### 3. 用户与用户组管理核心命令

在多用户操作系统中，必须熟练掌握账号生命周期治理与特权提权机制：

| 分类 | 常用命令与关键选项 | 功能描述与生产场景 | 演练示例 |
| :--- | :--- | :--- | :--- |
| **查询身份** | `whoami` | 打印当前登录终端的有效用户名 | `whoami` |
| | `id [用户名]` | 打印 UID、GID 及所属的所有附加组 | `id alice` |
| | `groups [用户名]` | 查看指定用户加入的所有组列表 | `groups alice` |
| **组管理** | `groupadd [组名]` | 新建一个用户组 | `groupadd devops` |
| | `groupdel [组名]` | 删除一个空的用户组 | `groupdel devops` |
| **用户管理** | `useradd -m -s <shell> <用户名>`| 新建用户（`-m` 强制创建家目录 `/home/用户名`）| `useradd -m -s /bin/bash bob` |
| | `usermod -aG <附加组> <用户名>` | 将用户加入附加组（`-aG` 追加组，绝不能漏 `-a`）| `usermod -aG devops bob` |
| | `passwd <用户名>` | 设置或重置用户密码 | `passwd bob` |
| | `userdel -r <用户名>` | 删除用户（`-r` 同时清理其家目录与邮件池） | `userdel -r bob` |
| **身份切换** | `su - [用户名]` | 完整切换至指定用户环境（`-` 会载入该用户的环境变量）| `su - bob` ➔ `exit` 退出 |
| | `sudo <命令>` | 以超级管理员（root）特权临时执行单条指令 | `sudo cat /etc/shadow` |

---

#### 4. VIM 核心操作速查表（肌肉记忆指南）

请在终端输入 `vim demo.txt`，重点演练三种模式的切换与按键：

```text
               ┌───────────────────────┐
               │    插入模式 (Insert)   │
               └───────────────────────┘
                 ▲                   │
       i, a, o   │                   │ Esc
                 │                   ▼
  ┌──────────────────────────────────────────────┐
  │              正常命令模式 (Normal)            │ ◄── 默认模式，按键即命令
  └──────────────────────────────────────────────┘
                 │                   ▲
           :     │                   │ Esc
                 ▼                   │
               ┌───────────────────────┐
               │   末行底行模式 (Command)│
               └───────────────────────┘
```

| 维度 | 按键 / 命令 | 功能与效果 | 演练指南 |
| :--- | :--- | :--- | :--- |
| **模式切换** | `i` | 在光标**当前位置前**切换为输入状态 | 常用编辑入口 |
| | `o` | 在光标**下方新建一行**并直接进入输入状态 | 极度顺手的换行写代码方式 |
| | `Esc` | 立即退出当前状态，回到**正常命令模式** | 遇到任何不确定情况，连按两下 `Esc` |
| | `:` | 在命令模式下按冒号，光标跳转至底部**末行模式**| 用于输入保存、退出、搜索替换指令 |
| **移动光标** | `gg` / `G` | 快速跳至文件**第一行** / **最后一行** | 长配置文件快速翻顶/翻底 |
| | `<行号>G` | 快速精准跳转至指定行 | 如 `15G` 直接定位至第 15 行 |
| | `0` / `$` | 跳转至当前行的**行首** / **行末** | 单行快速穿梭 |
| **编辑技巧** | `yy` / `3yy` | 复制当前单行 / 连续复制 3 行 | 配合 `p` 粘贴 |
| | `p` | 将复制或剪切的内容粘贴到光标下方 | 粘贴指令 |
| | `dd` / `2dd` | 删除（剪切）当前行 / 连续删除 2 行 | 极速删行 |
| | `u` / `Ctrl+r` | **撤销**上一次操作 / **重做**（反向撤销） | 改错挽回必备 |
| **查找替换** | `/关键字` | 向下搜索关键字，按 `n` 下一个，`N` 上一个 | 如 `/listen` 快速搜配置项 |
| | `:%s/old/new/g` | **全局替换**：将全文所有 `old` 替换为 `new` | `:%s/8080/9090/g` 批量修改端口 |
| **保存退出** | `:wq` 或 `ZZ` | 保存文件修改并正常退出 | 日常标准退出 |
| | `:q!` | **强制退出并不保存**任何改动 | 配置写坏了不想保存时的安全退路 |

> [!TIP]
> **可选拓展：Earendel VIM AI 注释辅助 (`:gen`)**
> 在 Earendel 终端的 VIM 中，如果你在末行模式输入 `:gen`，系统会根据当前光标所在的注释行尝试自动生成代码/配置。*(注：该特性需配置 API Key，本实验以熟练掌握原生 VIM 手工编辑为主，该命令作为了解项即可)*。

---

### Part B：任务挑战 —— 企业级服务配置加固与跨部门协作权限管理

#### 1. 业务背景
“阿波罗研发中心”正在投产核心微服务组件。目前生产服务器存在两项严重安全隐患：
1. 主配置文件 `/etc/apollo_service.conf` 存在遗留的测试脏数据与端口冲突，且文件权限过于宽松（全员可读可写），存在被普通用户随意篡改的灾难性风险；
2. 团队新加入两位成员：运维工程师 `ops_eva`（属于 `devops` 组）与实习开发人员 `intern_leo`（属于 `interns` 组）。需为 `devops` 团队开辟共享协作沙盒 `/data/apollo_shared/`，严防实习生及外部人员越权窥探。

---

#### 2. 挑战操作步骤

##### 步骤一：创建生产配置文件初始模板
在终端中执行以下指令，构造一份存在缺陷的待修复配置文件：
```bash
sudo mkdir -p /etc
cat << 'EOF' | sudo tee /etc/apollo_service.conf
# Apollo Cluster Service Configuration (PROD)
# Temporary Debug Line: Please remove this garbage line immediately!

[Server]
server_name = apollo_node_test
listen_port = 8080
max_workers = 4
debug_mode = true

[Database]
db_host = 127.0.0.1
db_port = 3306
db_pool = 10

[Network]
proxy_port = 8080
EOF
```

##### 步骤二：使用 VIM 深度修复配置文件 (`vim`, `dd`, `:%s`, `0`, `$`)
使用管理员权限打开该配置文件：
```bash
sudo vim /etc/apollo_service.conf
```
严格在 VIM 内按以下要求完成规范修复：
1. **删除废弃注释**：光标移动到第 2 行（`# Temporary Debug Line...`），在命令模式下按下 `dd` 将该废弃调试行整行删除。
2. **全局端口正则替换**：将配置中所有的 `8080` 统一替换为生产专用端口 `9090`。在末行模式输入：
   ```vim
   :%s/8080/9090/g
   ```
3. **参数手工修订**：
   - 找到 `server_name = apollo_node_test`，使用键盘导航进入插入模式，修改为 `server_name = apollo_node_prod`。
   - 找到 `debug_mode = true`，修改为 `debug_mode = false`。
4. **追加安全字段**：
   - 跳至文件末尾（输入 `G`），按 `o` 在新行插入如下两行生产安全配置：
     ```ini
     [Security]
     enable_firewall = true
     ```
5. 保存退出：按 `Esc`，输入 `:wq` 保存并退出。

##### 步骤三：用户组与多账号生命周期治理 (`groupadd`, `useradd`, `usermod`, `id`)
1. **创建专属业务用户组**：
   ```bash
   sudo groupadd devops
   sudo groupadd interns
   ```
2. **创建用户并配置初始归属**：
   - 创建运维工程师 `ops_eva`，为其建立家目录，并将其直接加入 `devops` 组：
     ```bash
     sudo useradd -m -g devops ops_eva
     ```
   - 创建实习生账号 `intern_leo`，为其建立家目录，加入 `interns` 组：
     ```bash
     sudo useradd -m -g interns intern_leo
     ```
3. **使用 `id` 验证账号属性**：
   ```bash
   id ops_eva
   id intern_leo
   ```
   *确认两者的 UID、主组 GID 符合隔离预期。*

##### 步骤四：配置文件最小特权治理与越权防范 (`chmod`, `chown`, `su`)
1. **加固生产配置文件**：
   - 确保该配置文件的属主为 `root`，属组为 `root`：
     ```bash
     sudo chown root:root /etc/apollo_service.conf
     ```
   - 将其权限设置为标准的 **644**（`rw-r--r--`：属主可读写，其他所有人仅只读）：
     ```bash
     sudo chmod 644 /etc/apollo_service.conf
     ```
2. **模拟黑客/越权篡改验证**：
   - 切换为实习生 `intern_leo` 身份：
     ```bash
     su - intern_leo
     ```
   - 尝试直接用命令向受保护的配置追加恶意内容：
     ```bash
     echo "hacked_by_leo = true" >> /etc/apollo_service.conf
     ```
   - **预期现象**：控制台拦截并输出 `Permission denied`，证明系统只读策略有效！
   - 执行 `exit` 退出 `intern_leo` 终端，回到原用户。

##### 步骤五：跨部门团队协作沙盒目录搭建 (`mkdir`, `chmod 770`, `chgrp`)
1. 创建共享协作目录：
   ```bash
   sudo mkdir -p /data/apollo_shared
   ```
2. 将该目录的所属组变更为 `devops`：
   ```bash
   sudo chgrp devops /data/apollo_shared
   ```
3. **设置严格的隔离权限**：
   - 将 `/data/apollo_shared` 的权限精准设置为 **770**（`rwxrwx---`）：
     ```bash
     sudo chmod 770 /data/apollo_shared
     ```
   - *含义解析：属主与 `devops` 组成员拥有完全控制权，而组外其他任何人（包括实习生 `intern_leo`）完全禁止读、写、进入！*
4. 在共享目录下生成协作指南：
   ```bash
   echo "DevOps Internal Project Documentation" | sudo tee /data/apollo_shared/README.txt
   sudo chgrp devops /data/apollo_shared/README.txt
   sudo chmod 660 /data/apollo_shared/README.txt
   ```

##### 步骤六：生成审计报告与成果签名交付 (`security_audit.txt`)
1. 收集验证信息并导出至用户家目录下的交付文件 `security_audit.txt`：
   ```bash
   # 1. 导出修复后的配置文件详情与前 25 行内容
   ls -l /etc/apollo_service.conf > ~/security_audit.txt
   head -n 25 /etc/apollo_service.conf >> ~/security_audit.txt
   
   # 2. 导出两个用户的账号信息
   echo -e "\n--- User Accounts ---" >> ~/security_audit.txt
   id ops_eva >> ~/security_audit.txt
   id intern_leo >> ~/security_audit.txt
   
   # 3. 导出共享沙盒的权限与所属组详情
   echo -e "\n--- Shared Workspace Permissions ---" >> ~/security_audit.txt
   ls -ld /data/apollo_shared >> ~/security_audit.txt
   ls -l /data/apollo_shared >> ~/security_audit.txt
   ```
2. 在报告文件末尾追加你的学号与姓名：
   ```bash
   echo -e "\n--- Student Signature ---" >> ~/security_audit.txt
   echo "Student_ID: 20260001" >> ~/security_audit.txt
   echo "Student_Name: ZhangSan" >> ~/security_audit.txt
   echo "Audit_Status: COMPLIANT_VERIFIED" >> ~/security_audit.txt
   ```

---

### 实验交付与评分标准

#### 交付物
- 最终生成的安全加固与审计报告文件：`~/security_audit.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察命令 / 技能点 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **VIM 原生编辑技巧** | 25分 | `vim`, `dd`, `:%s`, `G`, `o` | 废弃注释被 `dd` 彻底清除；全文 8080 成功替换为 9090；prod 与 debug 配置正确；末尾追加 Security 节 |
| **用户与组结构治理** | 20分 | `groupadd`, `useradd`, `id` | `devops` 与 `interns` 组创建规范；`ops_eva` 与 `intern_leo` 账号建立及主组指定准确 |
| **配置最小特权控制** | 20分 | `chmod 644`, `chown` | `/etc/apollo_service.conf` 权限为 644，归属 root:root，越权写入被有效拦截 |
| **共享沙盒隔离权限** | 20分 | `chmod 770`, `chgrp` | `/data/apollo_shared` 准确应用 770 权限，属组为 devops，外界访问权限被彻底收回 |
| **审计报告与成果签名** | 15分 | 重定向, `head`, 签名 | `security_audit.txt` 结构完备，各命令提取内容完整无缺失，附带准确签名 |
| **违规扣分项** | -10分 | — | 配置文件语法严重破损；滥用 777 权限；未清理垃圾调试行 |

---

### 思考与进阶拓展
1. **深入理解目录权限**：如果某个目录的权限是 `755`，而该目录下某个文件的权限是 `644`，普通用户能否使用 `rm` 命令删除这个文件？为什么？（提示：回顾 `w` 权限对目录的真正含义）。
2. **符号法与八进制法的转换**：请分别用“八进制数值法”和“符号运算法”写出两条等价的命令，将脚本 `backup.sh` 从 `644` 状态变为只有属主能执行、其他人只读的状态。
