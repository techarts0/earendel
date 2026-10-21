## 实验四：系统进程管理与周期任务调度

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时 (讲授 1 学时，练习 2 学时)
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]

---

### 实验目标

1. **掌握进程监控与信号控制**：熟练使用 `ps`, `top` 监控系统运行状态与 CPU/内存资源消耗，掌握 `kill` 与 `killall` 信号发送机制（SIGTERM 15、SIGKILL 9），能够精准终止异常进程。
2. **掌握作业控制（Job Control）机制**：掌握命令后台运行（`&`）、作业挂起（`Ctrl + Z`）、作业状态查看（`jobs`）以及前后台切换命令（`fg`, `bg`）。
3. **掌握周期性任务调度（Crontab）**：理解 cron 守护进程的运行机制与五段式时间调度语法，能够编写自动化维护脚本并部署周期性运维任务。

---

### Part A：核心知识点解析与自由练习

---

#### 1. 进程概念、状态观察与信号控制

> [!NOTE]
> **预备理论**：在 Linux 系统中，每一个正在执行的程序实例均表现为一个进程（Process），系统通过唯一的进程标识符（PID, Process ID）对其进行识别与资源调度。

##### (1) 进程状态观察命令（`ps` 与 `top`）
- `ps`（Process Status）：获取当前时间节点的进程快照。
  - `ps aux`：常用组合参数。`a` 显示包含其他终端的所有进程，`u` 显示进程属主信息，`x` 显示无控制终端的后台守护进程。
  - `ps -ef`：标准 System V 全格式显示，通常配合 `grep` 过滤目标进程：
    ```bash
    ps -ef | grep nginx
    ```
- `top`：交互式动态监控系统负载与各进程资源占用：
  - 界面按键：按 `P` 键按 CPU 使用率排序；按 `M` 键按内存占用排序；按 `q` 键退出界面。

##### (2) 进程终止与信号传递（`kill` 与 `killall`）
`kill` 命令通过向目标进程发送特定系统信号（Signal）实现控制：
- `kill -15 <PID>`（SIGTERM，终止信号）：默认信号。通知目标进程正常释放资源并退出。
- `kill -9 <PID>`（SIGKILL，强制终止信号）：由内核直接回收进程资源，目标进程无法捕获或忽略该信号。
- `killall <进程名>`：根据进程名称向所有同名进程发送信号。

##### (3) 作业控制（Job Control）
- `命令 &`：在命令末尾添加 `&`，使命令直接在后台异步执行。
- `Ctrl + Z`：向当前正在前台运行的进程发送 `SIGTSTP` 信号，将其暂停并挂起至后台。
- `jobs`：查看当前终端所关联的后台作业列表与作业编号。
- `bg %<作业号>`：将处于挂起状态的后台作业唤醒并在后台继续执行。
- `fg %<作业号>`：将后台作业调回前台控制。

---

#### 2. 周期性任务调度 (`crontab`)

Linux 系统通过 `cron` 守护进程周期性地检查并执行预设的自动化任务。

##### (1) Crontab 五段式时间字段格式
每一个调度任务在配置文件中占一行，格式如下：
```text
*  *  *  *  *  command_to_execute
┬  ┬  ┬  ┬  ┬
│  │  │  │  │
│  │  │  │  └── 星期 (0 - 7，0 与 7 均代表星期日)
│  │  │  └───── 月份 (1 - 12)
│  │  └──────── 日期 (1 - 31)
│  └─────────── 小时 (0 - 23)
└────────────── 分钟 (0 - 59)
```

##### (2) 常用调度通配符
- `*`：匹配该时间字段的所有可能值。
- `,`：指定离散时间点列表（例如 `1,15 * * * *` 表示每小时的第 1 分钟和第 15 分钟）。
- `-`：指定连续的时间范围（例如 `0 9-18 * * *` 表示 9 点到 18 点之间的每个整点）。
- `/`：指定执行频率间隔（例如 `*/5 * * * *` 表示每隔 5 分钟执行一次）。

##### (3) 常见配置示例
```text
# 每天凌晨 02:30 执行
30 2 * * * /path/to/script.sh

# 每小时整点执行一次
0 * * * * /path/to/script.sh

# 工作日（周一至周五）早上 08:00 执行
0 8 * * 1-5 /path/to/script.sh

# 每月 1 号与 15 号凌晨 03:00 执行
0 3 1,15 * * /path/to/script.sh
```

##### (4) `crontab` 常用管理命令
- `crontab -e`：编辑当前用户的定时任务配置文件。
- `crontab -l`：列出当前用户已配置的定时任务。
- `crontab -r`：删除当前用户的所有定时任务。

---

### Part B：任务挑战 —— 异常进程排查与配置自动备份调度

#### 1. 业务场景
运维人员需对一台负载异常的服务器进行排查，并为关键业务配置文件建立定时自动备份机制：
1. 监控系统运行状态，定位并终止后台高 CPU 消耗的死循环异常进程；
2. 编写带时间戳的配置文件自动备份脚本 `~/backup_service.sh`，赋予可执行权限并完成单次运行测试；
3. 配置 Crontab 周期性定时任务，设定脚本的定期执行计划；
4. 导出系统进程与调度审计报告文件 `~/sys_audit.txt` 并签名。

---

#### 2. 操作步骤

##### 步骤一：创建测试用高负载后台进程
在终端中执行以下命令，启动一个后台死循环计算进程用于模拟异常负载：
```bash
bash -c 'while true; do let a=1+1; done' &
```
*终端将返回作业号与对应的进程 PID，例如 `[1] 12345`。*

##### 步骤二：定位与终止异常进程 (`top`, `ps`, `kill`)
1. **查看系统负载**：
   执行 `top` 命令，观察 CPU 占用率最高的进程列表，记下占用率显著偏高的 `bash` 进程的 `PID`，按 `q` 退出 `top`。
2. **通过进程列表检索**：
   使用 `ps` 命令过滤确认该命令的完整执行信息与 PID：
   ```bash
   ps aux | grep while
   ```
3. **发送信号终止进程**：
   使用 `kill -15` 向该进程发送终止信号（假设其 PID 为 12345）：
   ```bash
   kill -15 12345
   ```
   *若进程未能及时响应，可使用 `kill -9 12345` 强制终止。*
4. **验证终止结果**：
   再次执行 `jobs` 或 `ps aux | grep while`，确认该异常进程已不存在。

##### 步骤三：编写与测试自动备份脚本
1. 确认待备份的目标配置文件 `/etc/app_service.conf` 存在（若不存在可创建基础模板）：
   ```bash
   sudo mkdir -p /etc
   if [ ! -f /etc/app_service.conf ]; then
     echo -e "[Server]\nserver_name = app_node_prod\nlisten_port = 9090" | sudo tee /etc/app_service.conf
   fi
   ```
2. 在用户家目录创建备份脚本 `~/backup_service.sh`：
   ```bash
   vim ~/backup_service.sh
   ```
3. 写入以下脚本内容：
   ```bash
   #!/bin/bash
   # 生成时间戳变量 (格式: YYYYMMDD_HHMM)
   TIMESTAMP=$(date +"%Y%m%d_%H%M")
   BACKUP_DIR="/data/shared_workspace/backups"
   
   # 确保备份目标目录存在
   mkdir -p $BACKUP_DIR
   
   # 执行配置文件备份
   cp /etc/app_service.conf $BACKUP_DIR/app_service_$TIMESTAMP.conf
   ```
4. 赋予脚本可执行权限并进行手工测试：
   ```bash
   chmod +x ~/backup_service.sh
   ~/backup_service.sh
   ```
5. 检查备份目录，确认已生成带时间戳的备份文件：
   ```bash
   ls -l /data/shared_workspace/backups/
   ```

##### 步骤四：配置 Crontab 周期性定时任务
1. 打开当前用户的定时任务编辑器：
   ```bash
   crontab -e
   ```
2. 在文件末尾添加以下调度规则（设定每隔 3 分钟执行一次，请确保脚本路径为当前用户的实际绝对路径）：
   ```text
   */3 * * * * /home/hello/backup_service.sh
   ```
   *(注：若当前用户非 hello，请使用 `pwd` 查得的家目录路径替换)*
3. 保存并退出编辑器。
4. 查看已安装的 Crontab 任务列表：
   ```bash
   crontab -l
   ```

##### 步骤五：生成进程与调度审计报告 (`sys_audit.txt`)
导出本次排查与调度配置结果至报告文件：
```bash
# 1. 导出备份脚本内容
echo "=== Backup Script Content ===" > ~/sys_audit.txt
cat ~/backup_service.sh >> ~/sys_audit.txt

# 2. 导出定时任务配置列表
echo -e "\n=== Crontab Configuration ===" >> ~/sys_audit.txt
crontab -l >> ~/sys_audit.txt

# 3. 导出备份文件生成验证结果
echo -e "\n=== Backup Execution Output ===" >> ~/sys_audit.txt
ls -l /data/shared_workspace/backups/ >> ~/sys_audit.txt

# 4. 追加学生签名
echo -e "\n=== Student Information ===" >> ~/sys_audit.txt
echo "Student_ID: 20260001" >> ~/sys_audit.txt
echo "Student_Name: ZhangSan" >> ~/sys_audit.txt
echo "Audit_Status: VERIFIED" >> ~/sys_audit.txt
```

---

### 实验交付与评分标准

#### 交付物
- 系统进程与调度审计报告文件：`~/sys_audit.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察知识点 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **异常进程定位与控制** | 30分 | `ps`, `top`, `kill` | 熟练使用 `top`/`ps` 获取异常进程 PID，正确运用信号终止目标进程，系统无残留死循环 |
| **自动化备份脚本编写** | 30分 | Shell 脚本, `chmod +x` | 脚本语法正确，具备可执行权限，能成功在目标目录下生成带时间戳的备份副本 |
| **Crontab 调度策略配置** | 25分 | `crontab -e`, 时间语法 | 正确运用五段式时间表达式，任务路径使用绝对路径，Crontab 列表中成功注册任务 |
| **审计报告规范性** | 15分 | 重定向, 规范输出 | `sys_audit.txt` 内容完整，脚本、调度规则与备份结果清晰呈现并附带签名 |

---

### 思考与进阶拓展

1. **计划任务执行权限与环境**：若备份脚本需要读取只有 root 权限才能访问的系统文件（如 `/etc/shadow`），在普通用户的 crontab 中执行该脚本能否成功？如何规范解决该权限问题？
2. **Crontab 环境变量与绝对路径**：cron 任务在执行时，其所加载的环境变量（尤其是 `PATH`）与用户交互式登录时的环境变量有何差异？为什么在编写 cron 调用的脚本时强烈建议内部命令与脚本调用均采用绝对路径？
