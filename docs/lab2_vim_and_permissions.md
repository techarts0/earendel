## 实验二：VIM 编辑器与多用户权限管理

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]

---

### 实验目标

1. **掌握 VIM 编辑器核心模式与操作**：掌握正常命令模式、插入编辑模式、末行模式的工作原理与切换方法，熟练运用光标定位、文本复制粘贴、整行删除、撤销重做、全局替换与保存退出。
2. **掌握用户与用户组管理体系**：理解 `/etc/passwd`、`/etc/shadow` 与 `/etc/group` 文件的组织结构，熟练运用 `useradd`、`usermod`、`userdel`、`groupadd`、`id`、`su`、`sudo` 进行账号与组的生命周期管理。
3. **理解 POSIX 文件权限模型**：掌握文件类型与 9 位权限位（`rwxrwxrwx`）的组成结构，明确读（r）、写（w）、执行（x）在普通文件与目录对象上的实际含义差异。
4. **熟练配置权限与属主属组**：掌握八进制数值法（如 755、644、770）与符号表示法（如 `u+x`, `g-w`, `o=r`），熟练使用 `chmod`、`chown`、`chgrp` 实施安全基线与目录访问隔离。

---

### Part A：核心知识点解析与自由练习

---

#### 1. Linux 文件权限与所有权模型

> [!NOTE]
> **预备理论**：在 Linux 系统中，一切资源皆表现为文件形式。系统为每个文件与目录维护其所有者（User/Owner）、所属组（Group）以及访问控制权限位，用于决定不同身份用户的读、写、执行能力。

##### (1) 权限属性字符串结构
使用 `ls -l` 查看长格式列表时，输出首部的 10 位字符表示文件类型与权限位分布：
```text
  -  r w x  r - x  r - -
  ┬  ─────  ─────  ─────
  │    │      │      │
  │    │      │      └── Other 权限：除属主与属组成员外的其他用户访问权限
  │    │      └──────── Group 权限：文件所属用户组成员的访问权限
  │    └────────────── User 权限：文件所有者独享的访问权限
  └────────────────── 类型标识：'-' 普通文件，'d' 目录，'l' 符号链接
```

##### (2) 权限位（r, w, x）在文件与目录上的含义差异

| 权限符号 | 对应数值 | 对**普通文件**的作用 | 对**目录**的作用 |
| :---: | :---: | :--- | :--- |
| **`r`** (Read) | **4** | 允许读取文件内容（如 `cat`, `head`） | 允许列出目录包含的文件名列表（如 `ls`） |
| **`w`** (Write)| **2** | 允许修改或追加文件内容（如 `vim` 保存） | 允许在目录下创建、删除、重命名文件 |
| **`x`** (eXecute)| **1** | 允许将文件作为程序或脚本执行（如 `./run.sh`） | 允许进入该目录（如 `cd`）并访问内部文件的元数据 |

> [!WARNING]
> **注意事项**：若对目录仅具备 `r` 权限而无 `x` 权限，用户虽可通过 `ls` 获取目录内的文件名列表，但无法通过 `cd` 进入该目录，亦无法读取内部文件的具体内容。

##### (3) 权限数值计算与八进制对应
每组权限由 3 个二进制位组合计算而成，取值范围为 `0 ~ 7`：
- `rwx` = 4 + 2 + 1 = **7**（完全访问控制）
- `rw-` = 4 + 2 + 0 = **6**（读写权限，常用于配置文件与文本数据）
- `r-x` = 4 + 0 + 1 = **5**（读与执行/进入权限，常用于脚本与目录）
- `r--` = 4 + 0 + 0 = **4**（只读权限）
- `---` = 0 + 0 + 0 = **0**（无任何权限）

---

#### 2. 权限与所有权配置命令 (`chmod`, `chown`, `chgrp`)

##### (1) `chmod`：修改访问权限
支持两种指定方式：
- **八进制数值法**：
  ```bash
  chmod 755 run.sh       # 属主 rwx(7)，属组 r-x(5)，其他用户 r-x(5)
  chmod 644 config.conf  # 属主 rw-(6)，属组 r--(4)，其他用户 r--(4)
  chmod 700 private_dir  # 仅属主拥有完整权限，其他身份无访问权
  ```
- **符号表示法**：
  - 操作对象：`u` (User 属主), `g` (Group 属组), `o` (Other 其他), `a` (All 全部用户)
  - 运算符号：`+` (添加), `-` (收回), `=` (精确设定)
  ```bash
  chmod +x build.sh       # 为所有用户添加可执行权限
  chmod g+w shared_doc    # 为所属组成员添加写权限
  chmod o-r secret.txt    # 移除其他用户的读权限
  chmod u=rwx,go=r file   # 属主具备读写执行，组与其他用户只读
  ```

##### (2) `chown` 与 `chgrp`：修改文件所有者与所属组
- `chown`：修改文件所有者，亦可一并修改所属组：
  ```bash
  chown alice file.txt          # 仅变更属主为 alice
  chown alice:devgroup dir      # 同时变更属主为 alice，属组为 devgroup
  chown -R alice:devgroup dir   # -R 递归处理目录下所有子项
  ```
- `chgrp`：单独修改文件所属组：
  ```bash
  chgrp devgroup project/       # 将 project 目录所属组修改为 devgroup
  ```

---

#### 3. 用户与组管理核心命令

| 分类 | 命令与常用选项 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| **身份查询** | `whoami` | 显示当前登录终端的有效用户名 | `whoami` |
| | `id [用户名]` | 输出用户的 UID、GID 及所属所有组信息 | `id alice` |
| | `groups [用户名]` | 查看指定用户所属的用户组列表 | `groups alice` |
| **组管理** | `groupadd [组名]` | 新建用户组 | `groupadd devops` |
| | `groupdel [组名]` | 删除空用户组 | `groupdel devops` |
| **用户管理** | `useradd -m -g <主组> <用户名>` | 新建用户（`-m` 创建家目录，`-g` 指定主组） | `useradd -m -g devops bob` |
| | `usermod -aG <附加组> <用户名>` | 将用户加入附加组（`-a` 追加） | `usermod -aG devops bob` |
| | `userdel -r <用户名>` | 删除用户账户（`-r` 同时删除家目录） | `userdel -r bob` |
| **切换与提权** | `su - [用户名]` | 切换至指定用户环境（`-` 加载目标用户环境变量） | `su - bob` |
| | `sudo <命令>` | 以管理员（root）特权执行单条命令 | `sudo cat /etc/shadow` |

---

#### 4. VIM 核心模式与常用按键

在终端执行 `vim demo.txt`，重点练习三种模式之间的转换与核心命令：

```text
               ┌───────────────────────┐
               │    插入模式 (Insert)   │
               └───────────────────────┘
                 ▲                   │
       i, a, o   │                   │ Esc
                 │                   ▼
  ┌──────────────────────────────────────────────┐
  │              正常命令模式 (Normal)            │ ◄── 启动默认模式，输入按键作为操作指令
  └──────────────────────────────────────────────┘
                 │                   ▲
           :     │                   │ Esc
                 ▼                   │
               ┌───────────────────────┐
               │   末行底行模式 (Command)│
               └───────────────────────┘
```

| 维度 | 按键 / 命令 | 功能与效果 | 使用说明 |
| :--- | :--- | :--- | :--- |
| **模式切换** | `i` | 在光标当前位置前进入插入模式 | 最基础的输入入口 |
| | `o` | 在光标所在行下方新建一行并进入插入模式 | 常用换行编辑方式 |
| | `Esc` | 退出当前编辑状态，返回正常命令模式 | 处于未知状态时连按两次可复位 |
| | `:` | 在命令模式下进入末行底行模式 | 用于执行保存、退出、搜索替换等指令 |
| **光标移动** | `gg` / `G` | 快速定位至文件首行 / 末行 | 长文件定位首尾 |
| | `<行号>G` | 定位至指定行号 | 如 `15G` 定位到第 15 行 |
| | `0` / `$` | 定位至当前行的行首 / 行末 | 行内移动 |
| **文本编辑** | `yy` / `<N>yy` | 复制光标所在行 / 复制光标开始的连续 N 行 | 配合 `p` 粘贴 |
| | `p` | 将复制或删除的内容粘贴到光标下方 | 粘贴内容 |
| | `dd` / `<N>dd` | 删除（剪切）光标所在行 / 连续删除 N 行 | 行删除 |
| | `u` / `Ctrl+r` | 撤销上一步操作 / 重做（反撤销） | 误操作恢复 |
| **查找替换** | `/关键词` | 向下检索关键字，按 `n` 查找下一个，`N` 查找上一个 | 快速检索配置项 |
| | `:%s/old/new/g` | 全局正则替换：将全文所有 `old` 替换为 `new` | 批量修改配置 |
| **保存退出** | `:wq` | 保存当前更改并退出 VIM | 标准保存退出 |
| | `:q!` | 强制退出且放弃所有修改 | 放弃不正确修改的安全方式 |

---

### Part B：任务挑战 —— 服务配置维护与跨部门协作权限管理

#### 1. 业务场景
系统管理人员需维护服务器上的应用配置文件并建立安全的团队协作目录：
1. 修复主配置文件 `/etc/app_service.conf` 中的格式错误与废弃调试项，使用全局替换更新端口配置，并将文件权限收敛为只读（644），防止未授权篡改；
2. 建立运维工程组（`devops`）与普通实习组（`interns`），分别创建对应用户并配置组归属；
3. 为 `devops` 组建立专用的协作共享目录 `/data/shared_workspace`，设置严格的组隔离权限（770），验证非组成员无权访问；
4. 导出安全审计报告文件 `~/permission_audit.txt` 并附带签名。

---

#### 2. 操作步骤

##### 步骤一：创建待维护的初始配置文件
在终端中执行以下指令，生成待修复的配置文件模板：
```bash
sudo mkdir -p /etc
cat << 'EOF' | sudo tee /etc/app_service.conf
# Cluster Service Configuration (PROD)
# Temporary Debug Line: Please remove this debug comment!

[Server]
server_name = app_node_test
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

##### 步骤二：使用 VIM 修复配置文件 (`vim`, `dd`, `:%s`, `0`, `$`)
使用管理员权限打开配置文件：
```bash
sudo vim /etc/app_service.conf
```
在 VIM 中按以下要求完成编辑操作：
1. **删除调试行**：移动光标至第 2 行（`# Temporary Debug Line...`），在命令模式下按 `dd` 删除该注释行。
2. **全局替换端口**：将文件中所有 `8080` 统一替换为生产端口 `9090`，在末行模式下输入：
   ```vim
   :%s/8080/9090/g
   ```
3. **参数修订**：
   - 将 `server_name = app_node_test` 修改为 `server_name = app_node_prod`；
   - 将 `debug_mode = true` 修改为 `debug_mode = false`。
4. **追加配置节**：
   - 移动光标至文件末尾（输入 `G`），按 `o` 插入新行，输入以下配置内容：
     ```ini
     [Security]
     enable_firewall = true
     ```
5. **保存并退出**：按 `Esc` 返回命令模式，输入 `:wq` 保存退出。

##### 步骤三：用户组与多账号生命周期管理 (`groupadd`, `useradd`, `id`)
1. **创建工作组**：
   ```bash
   sudo groupadd devops
   sudo groupadd interns
   ```
2. **创建用户账户并指定主组**：
   - 创建运维人员 `ops_eva`，为其建立家目录并加入 `devops` 组：
     ```bash
     sudo useradd -m -g devops ops_eva
     ```
   - 创建测试人员 `intern_leo`，为其建立家目录并加入 `interns` 组：
     ```bash
     sudo useradd -m -g interns intern_leo
     ```
3. **验证账户属性**：
   ```bash
   id ops_eva
   id intern_leo
   ```
   *核对两者的 UID、主组 GID 及所属组划分情况。*

##### 步骤四：配置文件访问控制与写入权限验证 (`chmod`, `chown`, `su`)
1. **收紧配置文件权限**：
   - 设定配置文件属主与属组为 `root:root`：
     ```bash
     sudo chown root:root /etc/app_service.conf
     ```
   - 设置权限为标准 **644**（`rw-r--r--`）：
     ```bash
     sudo chmod 644 /etc/app_service.conf
     ```
2. **验证只读限制**：
   - 切换为普通用户 `intern_leo` 身份：
     ```bash
     su - intern_leo
     ```
   - 尝试向配置文件追加内容：
     ```bash
     echo "unauthorized_change = true" >> /etc/app_service.conf
     ```
   - 确认终端输出 `Permission denied`，验证非属主写保护生效。
   - 执行 `exit` 返回原用户会话。

##### 步骤五：建立组协作共享目录与权限隔离 (`mkdir`, `chmod 770`, `chgrp`)
1. 创建团队共享协作目录：
   ```bash
   sudo mkdir -p /data/shared_workspace
   ```
2. 将该目录的所属组变更为 `devops`：
   ```bash
   sudo chgrp devops /data/shared_workspace
   ```
3. **配置协作隔离权限**：
   - 将目录权限设置为 **770**（`rwxrwx---`）：
     ```bash
     sudo chmod 770 /data/shared_workspace
     ```
   - *（属主与 devops 组成员具备完整读写执行权限，其他用户完全禁止访问）*
4. 在共享目录下生成说明文件并分配组读写权限：
   ```bash
   echo "DevOps Team Workspace Documentation" | sudo tee /data/shared_workspace/README.txt
   sudo chgrp devops /data/shared_workspace/README.txt
   sudo chmod 660 /data/shared_workspace/README.txt
   ```

##### 步骤六：生成权限审计报告 (`permission_audit.txt`)
导出检查结果至报告文件并签名：
```bash
# 1. 导出配置文件属性与前 25 行内容
ls -l /etc/app_service.conf > ~/permission_audit.txt
head -n 25 /etc/app_service.conf >> ~/permission_audit.txt

# 2. 导出账户与组信息
echo -e "\n=== User Accounts ===" >> ~/permission_audit.txt
id ops_eva >> ~/permission_audit.txt
id intern_leo >> ~/permission_audit.txt

# 3. 导出共享目录权限状态
echo -e "\n=== Shared Workspace Permissions ===" >> ~/permission_audit.txt
ls -ld /data/shared_workspace >> ~/permission_audit.txt
ls -l /data/shared_workspace >> ~/permission_audit.txt

# 4. 追加学生签名
echo -e "\n=== Student Information ===" >> ~/permission_audit.txt
echo "Student_ID: 20260001" >> ~/permission_audit.txt
echo "Student_Name: ZhangSan" >> ~/permission_audit.txt
echo "Audit_Status: COMPLIANT_VERIFIED" >> ~/permission_audit.txt
```

---

### 实验交付与评分标准

#### 交付物
- 权限与配置审计报告文件：`~/permission_audit.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察命令 / 技能点 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **VIM 编辑与正则替换** | 25分 | `vim`, `dd`, `:%s`, `G`, `o` | 调试注释准确删除；8080 全文替换为 9090；prod 与 debug 项修改准确；成功追加 Security 节 |
| **用户与组结构配置** | 20分 | `groupadd`, `useradd`, `id` | 正确创建 `devops` 与 `interns` 组；规范创建 `ops_eva` 与 `intern_leo` 账户并正确分配主组 |
| **配置文件最小特权** | 20分 | `chmod 644`, `chown` | `/etc/app_service.conf` 归属 root:root 且权限为 644，普通用户写入被正确拒绝 |
| **共享目录隔离策略** | 20分 | `chmod 770`, `chgrp` | `/data/shared_workspace` 属组为 devops 且应用 770 权限，实现针对其他用户的隔离 |
| **审计报告规范性** | 15分 | 重定向, `head`, 签名 | `permission_audit.txt` 结构整洁，配置文件、账户、目录权限信息完整并附带签名 |

---

### 思考与进阶拓展

1. **目录执行权限的作用机制**：若某目录权限设置为 `755`，而该目录下某文件的权限为 `644`，普通用户能否使用 `rm` 命令删除该文件？说明其判断依据（提示：结合写权限对目录对象的定义进行分析）。
2. **符号法与八进制表示法的等效转换**：请分别使用“八进制数值法”和“符号表示法”写出两条等价的 `chmod` 命令，将文件 `script.sh` 从 `644` 状态修改为：属主具备读写执行权限（rwx），属组与其他用户仅保留只读权限（r--）。
