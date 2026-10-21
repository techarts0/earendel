## 实验六：Shell 自动化编程与 ECC 编译工具链

- **适用课程**：Linux 操作系统
- **推荐学时**：3 学时（讲授 1 学时，练习 2 学时）
- **实验平台**：Earendel Web OS [https://earendel.techarts.cn]

---

### 实验目标

1. **掌握 Shell 脚本核心语法**：熟练掌握变量定义、引用规则、流程控制结构（`if`/`for`/`while`）与函数封装，编写结构严谨的自动化运维脚本。
2. **掌握退出状态码与流程控制机制**：深入理解退出状态码（`$?`）在命令执行与逻辑判断中的核心作用，掌握脚本级条件拦截与错误处理。
3. **理解编译工具链与可执行文件结构**：掌握 ECC 编译器的核心参数（`-o`、`-O2`、`-s`），理解 EAF（Earendel Application Format）分段组织结构及其与 Linux ELF 的设计映射关系。
4. **构建自动化发布流水线（CI/CD）**：综合运用 Shell 流程控制与 ECC 工具链，实现源码检查、自动编译、状态校验、冒烟测试与构建报告生成的全流程自动化。

---

### Part A：核心知识点解析与基础练习

在终端中创建并进入本实验工作目录：
```bash
mkdir -p ~/lab6 && cd ~/lab6
```

---

#### 1. Shell 编程核心语法

##### (1) 变量引用与退出状态码 (`$?`)
- **变量定义**：等号两侧严禁空格，如 `APP="demo"`。引用变量推荐使用 `${APP}`。
- **引号机制**：
  - 双引号 `""`（弱引用）：允许变量展开与命令替换；
  - 单引号 `''`（强引用）：保持字符字面值，不进行变量解析。
- **退出状态码（Exit Code）**：
  - 进程执行完毕向操作系统返回整数状态码：`0` 表示执行成功，非 `0`（1~255）表示发生错误或异常；
  - 环境变量 **`$?`** 保存上一条命令的退出状态码，必须在目标命令执行后**立即读取或暂存**，后续命令会覆盖其数值。

**语法演练**：
```bash
#!/bin/bash
# 1. 引号对比
NAME="Earendel"
echo "弱引用: Current OS is $NAME"
echo '强引用: Current OS is $NAME'

# 2. 状态码捕获
ls /etc/hosts > /dev/null
echo "成功命令退出码: $?"   # 输出 0

ls /not_exist_file 2> /dev/null
echo "失败命令退出码: $?"   # 输出非 0
```

##### (2) 流程控制结构（条件分支与循环）
- **条件判断 (`if`)**：通过测试表达式 `[ 条件 ]` 进行逻辑判断，常用测试项包括：
  - 文件检查：`-f <文件>`（普通文件存在）、`-d <目录>`（目录存在）；
  - 数值比对：`-eq`（等于）、`-ne`（不等于）、`-ge`（大于等于）、`-lt`（小于）；
  - 状态拦截：`if [ $? -ne 0 ]; then ... exit 1; fi`。
- **循环结构 (`for` / `while`)**：
  - `for 变量 in 列表; do ... done`：用于遍历数组或集合；
  - `while [ 条件 ]; do ... done`：用于基于条件的循环执行。

**语法演练**：
```bash
#!/bin/bash
# 目录检查与创建
if [ ! -d "build" ]; then
  mkdir -p build
  echo "创建构建目录: build/"
fi

# 阶段遍历
STAGES=("Lint" "Compile" "Test")
for stage in "${STAGES[@]}"; do
  echo "==> 执行阶段: $stage"
done
```

##### (3) 函数与模块化封装
Shell 函数通过 `$1`、`$2` 接收位置参数，内部可通过 `return` 返回状态码（0~255）：
```bash
log_info() {
  local module=$1
  local msg=$2
  echo "[$(date '+%H:%M:%S')] [$module] $msg"
}

log_info "BuildEngine" "Initialization complete."
```

---

#### 2. ECC 编译器与 EAF 文件结构

##### (1) ECC 编译器概述
在标准 Linux 环境中，开发者使用 GCC/Clang 编译源码生成二进制 ELF 文件；在 Earendel 系统中，内置了教学编译工具链 **ECC**（Earendel Compiler Collection），用于将应用程序源码编译打包为可执行文件格式 **EAF**（Earendel Application Format）。

基本命令格式：
```bash
ecc <源文件.js> -o <输出文件.eaf> [编译选项]
```

常用选项参数：
- `-o <路径>`：指定编译输出文件路径（未指定时默认输出 `a.out.eaf`）；
- `-O2`：启用优化模式，自动剔除无用注释与冗余空白，缩小文件体积；
- `-s`（或 `--strip`）：剥离符号表（去除调试与导出符号信息，进一步减小体积）；
- `--embed <资源路径>`：将静态配置或资源文件嵌入生成的可执行文件内部。

##### (2) EAF 结构剖析与 ELF 概念映射
EAF 借鉴了 Unix/Linux 经典 ELF（Executable and Linkable Format）的分段设计理念：

| 组成部分 | Linux ELF 对应物 | Earendel EAF 对应字段 | 作用与说明 |
| :--- | :--- | :--- | :--- |
| **文件头标识** | ELF Magic Number (`0x7F 'E' 'L' 'F'`) | `magic: "EAF01"` | 标识文件格式合法性 |
| **程序头信息** | ELF Header (入口地址、目标架构) | `header` (`entry`, `arch`, `type`) | 记录运行入口、平台架构与创建信息 |
| **代码段** | `.text` Section (机器指令) | `.text` Section | 存放编译链接后的核心执行逻辑 |
| **数据段** | `.data` Section (全局数据与常量) | `.data` Section | 存放应用元数据、配置项及嵌入的静态资源 |
| **符号表** | `.symtab` / `.strtab` | `.symtab` Section | 记录符号与函数名映射，可由 `-s` 选项安全剥离 |

---

#### 3. ECC 编译参数对照实验

在 `~/lab6` 目录下创建测试代码 `hello.js`：
```javascript
// ECC Benchmark Program
// Author: Linux Teaching Lab
const title = "Linux Shell & Compiler Lab";
const version = "1.0.0";

console.log("=== " + title + " ===");
console.log("Build Version: " + version);
```

依次执行不同参数的编译对比：

```bash
mkdir -p ~/lab6/build

# 1. 基础编译：生成目标文件并执行
ecc hello.js -o build/hello.eaf
./build/hello.eaf

# 2. 优化对比 (-O2)：对比注释剥离效果
ecc hello.js -O2 -o build/hello-o2.eaf
grep "Benchmark" build/hello.eaf       # 保留了注释
grep "Benchmark" build/hello-o2.eaf    # 注释已被剔除

# 3. 符号剥离 (-s)：对比符号表分节
ecc hello.js -s -o build/hello-stripped.eaf
grep "symtab" build/hello.eaf          # 包含符号表
grep "symtab" build/hello-stripped.eaf # 符号表已被移除

# 4. 编译错误状态码拦截验证
ecc missing_file.js -o build/err.eaf
echo "错误编译退出码: $?"               # 输出非 0
```

---

### Part B：任务挑战 —— 自动化编译构建与发布流水线（CI/CD）

#### 1. 业务场景
在软件工程与持续集成（CI/CD）流程中，为避免人工编译与发布可能产生的环境不一致和遗漏错误，需建立规范的自动化构建发布脚本 `deploy.sh`：
1. **前置检查**：检查源码文件是否存在，异常时立即阻断；
2. **流程编译**：调用 ECC 工具链进行代码优化与符号剥离，捕获并拦截编译失败状态；
3. **冒烟测试**：自动执行生成的目标可执行程序，验证其退出状态码；
4. **生成审计报告**：记录流水线构建时间、编译参数及最终发布状态至 `build-report.txt`；
5. **健壮性测试**：模拟源码丢失与语法错误场景，验证脚本的异常阻断能力。

---

#### 2. 操作步骤

##### 步骤一：创建项目源码文件
在 `~/lab6/app_project` 目录下创建待发布的主程序 `app.js`：
```bash
mkdir -p ~/lab6/app_project && cd ~/lab6/app_project

cat << 'EOF' > app.js
// Production Application Module
const appName = "ServiceMonitor";
const releaseVersion = "2.0.0";

console.log("Application : " + appName);
console.log("Version     : " + releaseVersion);
console.log("Status      : All services operational.");
EOF
```

##### 步骤二：编写自动化构建流水线脚本 `deploy.sh`
在 `~/lab6/app_project/deploy.sh` 中实现全流程流水线逻辑：

```bash
#!/bin/bash
# ==================================================
# 自动化构建与发布流水线脚本 (CI/CD Pipeline)
# ==================================================

SOURCE="app.js"
BUILD_DIR="build"
OUTPUT="build/app.eaf"
REPORT="build-report.txt"

echo "=== 开始执行自动化构建发布流水线 ==="

# 阶段 1: 创建输出目录
mkdir -p $BUILD_DIR

# 阶段 2: 源码文件前置检查
if [ ! -f "$SOURCE" ]; then
  echo "[ERROR] 源码文件 $SOURCE 不存在，流水线阻断终止。"
  exit 1
fi
echo "[PASS] 源码检查通过: $SOURCE"

# 阶段 3: 调用 ECC 工具链进行优化与瘦身编译
echo "[BUILD] 正在调用 ECC 编译程序 (参数: -O2 -s)..."
ecc $SOURCE -O2 -s -o $OUTPUT
BUILD_STATUS=$?

if [ $BUILD_STATUS -ne 0 ]; then
  echo "[ERROR] ECC 编译失败 (退出码: $BUILD_STATUS)，终止发布！"
  echo "Build Failed at $(date)" > $REPORT
  exit 2
fi
echo "[PASS] 编译成功，生成目标文件: $OUTPUT"

# 阶段 4: 冒烟测试 (执行目标文件验证基本功能)
echo "[TEST] 正在启动可执行文件进行冒烟测试..."
./$OUTPUT
TEST_STATUS=$?

if [ $TEST_STATUS -ne 0 ]; then
  echo "[ERROR] 程序冒烟测试未通过 (退出码: $TEST_STATUS)！"
  exit 3
fi
echo "[PASS] 冒烟测试全部通过。"

# 阶段 5: 生成构建归档报告
echo "=== CI/CD Build Audit Report ===" > $REPORT
echo "Build Time: $(date)" >> $REPORT
echo "Source File: $SOURCE" >> $REPORT
echo "Target File: $OUTPUT" >> $REPORT
echo "Compiler Flags: -O2 -s" >> $REPORT
echo "Pipeline Status: SUCCESS" >> $REPORT
echo "Student_ID: 20260001" >> $REPORT
echo "Student_Name: ZhangSan" >> $REPORT

echo "=== 流水线执行成功，构建报告已生成至: $REPORT ==="
```

##### 步骤三：配置执行权限与正常流水线测试
1. 赋予脚本执行权限：
   ```bash
   chmod +x deploy.sh
   ```
2. 运行构建流水线：
   ```bash
   ./deploy.sh
   ```
3. 查看生成的构建审计报告：
   ```bash
   cat build-report.txt
   ```

##### 步骤四：异常注入与脚本健壮性测试
1. **测试用例 1：源码文件丢失阻断测试**
   ```bash
   # 临时移走源码文件
   mv app.js app.js.bak
   ./deploy.sh
   echo "流水线退出码: $?"
   # 确认终端阻断在阶段 2，退出码为 1
   
   # 恢复源码文件
   mv app.js.bak app.js
   ```

2. **测试用例 2：语法错误编译拦截测试**
   ```bash
   # 在源码中注入非法语法
   echo "invalid_syntax_error %%%;" > app.js
   ./deploy.sh
   echo "流水线退出码: $?"
   # 确认终端在阶段 3 编译失败并安全退出，退出码为 2
   
   # 恢复正确的源码并验证重新构建
   cat << 'EOF' > app.js
   // Production Application Module
   const appName = "ServiceMonitor";
   const releaseVersion = "2.0.0";
   console.log("Application : " + appName);
   console.log("Version     : " + releaseVersion);
   console.log("Status      : All services operational.");
   EOF
   
   ./deploy.sh
   ```

---

### 实验交付与评分标准

#### 交付物
- 自动化构建脚本文件：`~/lab6/app_project/deploy.sh`
- 构建归档审计报告：`~/lab6/app_project/build-report.txt`

#### 评分标准（满分 100 分）

| 评分维度 | 分值 | 考察知识点 | 评分指标与判定标准 |
| :--- | :---: | :--- | :--- |
| **Shell 语法与流程控制** | 25分 | 变量, `if` 分支, 函数 | 脚本语法严谨无报错，正确运用变量引用与条件判断 |
| **状态码捕获与阶段拦截** | 25分 | `$?`, `exit <N>` | 正确捕获编译与测试返回值，在异常发生时安全阻断且退出码符合要求 |
| **编译参数与 EAF 验证** | 25分 | `ecc -o -O2 -s` | 熟练运用 ECC 核心参数，准确说明 `-O2`（注释剥离）与 `-s`（符号剥离）的实际效果 |
| **流水线交付与审计报告** | 15分 | 冒烟测试, 重定向 | 成功执行冒烟测试，规范生成 `build-report.txt`，包含编译参数与签名 |
| **健壮性与故障注入测试** | 10分 | 异常处理, 边界测试 | 准确复现源码丢失与编译错误拦截，验证流水线脚本健壮性 |

---

### 思考与进阶拓展

1. **状态码的时效性与暂存机制**：在 Shell 脚本中，为什么必须在目标命令执行后紧接着将 `$?` 赋值给变量（例如 `STATUS=$?`）？如果中间穿插了 `echo` 或其它命令，会导致什么逻辑缺陷？
2. **编译器参数权衡与安全考量**：在生产交付环境中，为何推荐对可执行文件执行符号表剥离（`-s`）？除了减小文件存储体积外，从系统安全的角度看还有何收益？
3. **分段式可执行文件结构的设计优势**：EAF 与 Linux ELF 均采用分段（Section/Segment）思想将代码（`.text`）与数据（`.data`）分离存放。这种结构在内存保护、权限管理（如代码段只读可执行，数据段可读写不可执行）方面有何优势？
