# Tangram LMS 外部实验引擎集成 API 文档 (External Lab Engine API)

本文档定义了 Tangram LMS 与外部实验沙箱（如 **Earendel V8 Linux 微内核操作系统**、第三方仿真器等）之间的标准集成协议与 RESTful API 规范。

---

## 🛠️ 前置约定：配置文件 `/etc/lms.conf`

外部系统（如 Earendel OS）在启动时从 URL 参数中解析出 `issue_id`、`project_id`、`token`，并自动写入微内核虚拟文件系统 `/etc/lms.conf`：

```json
{
  "api_base": "http://localhost:3001",
  "issue_id": "12",
  "project_id": "c7a8b9f0-1234-5678-9abc-def012345678",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## 📡 核心指令与 RESTful API 规范

所有请求均需在 HTTP Header 中携带鉴权信息：
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

---

### 1. `lms pull` / `lms status` —— 拉取实验代码与状态

- **请求方式**：`GET`
- **URL 路径**：`${api_base}/api/external/labs/${issue_id}`
- **说明**：
  - 用于 `lms pull` 下载初始实验代码（从 `project.logic` 字段提取）和**自动化测试脚本代码**（从 `test_code` 字段提取纯代码文本）。
  - **关于代码模板**：若教师未提供初始代码模板，`project.logic` 为 `null` 或 `""`，学生根据 `content` 中的文字描述自行创建代码文件即可。
  - **关于测试用例/脚本**：`test_code` 返回纯代码文本（按照 Earendel 测试框架编写的脚本，如 `test.js` / `test.c` / `test.sh`），Earendel OS 执行该脚本自动测出通过用例数与得分。
  - 用于 `lms status` 查看实验课题名称、截止时间、是否已提交及当前得分。
  - **智能特性**：若学生首次打开此实验，该接口会自动执行“接收实验”操作并克隆模板。

#### 📥 返回响应示例 (JSON):
```json
{
  "issue_id": 12,
  "experiment_id": 5,
  "name": "实验一：Linux 进程与线程管理",
  "content": "### 实验要求\n请实现 fork 与管道通信...",
  "type": "interactive",
  "engine_type": "v8_linux",
  "deadline": "2026-09-10T23:59:59.000Z",
  "late_penalty_per_day": 5,
  "status": "received",
  "score": null,
  "test_result": null,
  "project": {
    "id": "c7a8b9f0-1234-5678-9abc-def012345678",
    "name": "实验一：Linux 进程与线程管理 - 张三",
    "engine_type": "v8_linux",
    "logic": "/* 教师初始模板代码 (若无模板则为 null/空字符串) */\n#include <stdio.h>\n...",
    "source": ""
  },
  "test_code": "// Earendel 自动化评测脚本 (纯代码文本)\nconst { test, assert } = require('earendel-test');\n\ntest('用例1: 进程创建测试', async () => {\n  const res = await runProcess();\n  assert(res.code === 0);\n});\n",
  "testcases": []
}
```

---

### 2. `lms save [file]` —— 暂存当前代码进度

- **请求方式**：`PUT`
- **URL 路径**：`${api_base}/api/external/projects/${project_id}`
- **说明**：用于中途自动保存，将当前编辑的代码保存到云端 `projects.logic`（防止关闭网页丢失代码）。

#### 📤 请求 Body (JSON):
| 字段 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `logic` | `string` 或 `object` | **是** | 学生当前编辑的代码文本内容（或配置） |
| `source` | `string` | 否 | 附加信息/备注（可选） |

```json
{
  "logic": "console.log('正在调试的代码...');",
  "source": "自动保存"
}
```

#### 📥 返回响应示例 (JSON):
```json
{
  "success": true,
  "message": "实验进度保存成功",
  "project_id": "c7a8b9f0-1234-5678-9abc-def012345678",
  "updated_at": "2026-08-23T22:00:00.000Z"
}
```

---

### 3. `lms commit [file]` —— 测试并提交最终实验

- **请求方式**：`POST`
- **URL 路径**：`${api_base}/api/external/labs/${issue_id}/submit`
- **说明**：
  - 最终提交实验。
  - 外部引擎运行测试脚本得出分数（`score`）和用例状态（`test_result`），上报后 LMS 自动计算逾期扣分并将成绩归档为 `graded`。

#### 📤 请求 Body (JSON):
| 字段 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `project_id` | `string` | **是** | 项目 ID（从 `/etc/lms.conf` 读取） |
| `logic` | `string` 或 `object` | **是** | 最终提交的代码文本内容 |
| `score` | `number` | **是** | 外部引擎评测给出的原始得分（0 ~ 100） |
| `test_result` | `number` | 否 | 1 = 测试全部通过，0 = 存在失败用例（默认 1） |
| `auto_score_detail`| `object` | 否 | 测试日志/用例通过明细（可任意自定义结构） |
| `report_content` | `string` | 否 | 实验心得小结（可选） |

```json
{
  "project_id": "c7a8b9f0-1234-5678-9abc-def012345678",
  "logic": "#include <stdio.h>\nint main() { printf(\"Done!\\n\"); return 0; }",
  "score": 100,
  "test_result": 1,
  "auto_score_detail": {
    "total_tests": 5,
    "passed_tests": 5,
    "logs": "[PASS] test_case_1\n[PASS] test_case_2\n[PASS] test_case_3\n..."
  },
  "report_content": "实验已通过全部单元测试"
}
```

#### 📥 返回响应示例 (JSON):
```json
{
  "success": true,
  "score": 100,
  "raw_score": 100,
  "penalty": 0,
  "status": "graded",
  "message": "实验已成功提交并自动评分完成！"
}
```

---

### 4. `lms whoami` —— 身份核对（可选）

- **请求方式**：`GET`
- **URL 路径**：`${api_base}/api/external/me`
- **说明**：用于检验 Token 是否有效，获取当前登录学生的学号与姓名。

#### 📥 返回响应示例 (JSON):
```json
{
  "id": 101,
  "username": "20260101",
  "name": "张三",
  "role": "student",
  "identity_number": "20260101",
  "gender": "male",
  "org_id": 1
}
```

---

## 💻 客户端 JS / Node 快速集成 SDK 范例

```javascript
const fs = require('fs');

// 1. 读取配置文件
const conf = JSON.parse(fs.readFileSync('/etc/lms.conf', 'utf-8'));

// 2. 通用请求封装
async function lmsRequest(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${conf.token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${conf.api_base}${path}`, options);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `请求失败: HTTP ${response.status}`);
  }
  return await response.json();
}

// 3. 具体指令操作示例
async function pull() {
  const lab = await lmsRequest(`/api/external/labs/${conf.issue_id}`);
  console.log(`[✓] 成功拉取实验: ${lab.name}`);
  fs.writeFileSync('./main.c', lab.project?.logic || '');
}

async function save(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  await lmsRequest(`/api/external/projects/${conf.project_id}`, 'PUT', {
    logic: code,
    source: '自动保存'
  });
  console.log('[✓] 实验进度已暂存至云端');
}

async function commit(filePath, score = 100, testLogs = '') {
  const code = fs.readFileSync(filePath, 'utf-8');
  const result = await lmsRequest(`/api/external/labs/${conf.issue_id}/submit`, 'POST', {
    project_id: conf.project_id,
    logic: code,
    score: score,
    test_result: score >= 60 ? 1 : 0,
    auto_score_detail: { logs: testLogs }
  });
  console.log(`[✓] 实验提交成功！最终成绩: ${result.score} 分 (状态: ${result.status})`);
}
```
