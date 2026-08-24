import { Command, ExecutionContext, ExecutionResult } from '../types';
import { eslibNet } from '../eslibNet';
import { globalJsEngine } from '../jsRuntime';

interface LMSConfig {
  baseUrl: string;
  projectId: string;
  issueId: string;
  token: string;
}

function parseLmsConfig(vfs: ExecutionContext['vfs']): LMSConfig {
  const content = vfs.readFile('/etc/lms.conf') || '';
  const conf: Record<string, string> = {};

  // 支持 KEY=VALUE 格式以及 JSON 格式解析
  if (content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      return {
        baseUrl: parsed.api_base || parsed.LMS_BASE_URL || 'https://edu.tangram.techarts.cn',
        projectId: parsed.project_id || parsed.PROJECT_ID || '',
        issueId: String(parsed.issue_id || parsed.ISSUE_ID || ''),
        token: parsed.token || parsed.TOKEN || '',
      };
    } catch (e) {
      // fallback to key-value
    }
  }

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim().toUpperCase();
      const val = trimmed.slice(eqIdx + 1).trim();
      conf[key] = val;
    }
  }

  return {
    baseUrl: conf['LMS_BASE_URL'] || conf['API_BASE'] || 'https://edu.tangram.techarts.cn',
    projectId: conf['PROJECT_ID'] || '',
    issueId: conf['ISSUE_ID'] || '',
    token: conf['TOKEN'] || '',
  };
}

// 辅助请求函数
async function lmsRequest(config: LMSConfig, path: string, method: string = 'GET', body: any = null): Promise<any> {
  const base = (config.baseUrl || 'https://edu.tangram.techarts.cn').replace(/\/$/, '');
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  const opts: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers,
  };
  if (body !== null && body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await eslibNet.fetch(url, opts);
  if (typeof response === 'string') {
    try {
      return JSON.parse(response);
    } catch (e) {
      return response;
    }
  }
  return response;
}

// 辅助函数：根据文件扩展名或特征推断主入口代码
function findMainCodeFile(vfs: ExecutionContext['vfs'], projectFolder: string, targetFile?: string): { path: string; content: string; name: string } | null {
  if (targetFile) {
    const absPath = targetFile.startsWith('/') ? targetFile : `${projectFolder}/${targetFile}`.replace(/\/+/g, '/');
    const node = vfs.getNodeByPath(absPath);
    if (node && node.type === 'file') {
      return { path: absPath, content: node.content || '', name: node.name };
    }
  }

  // 统一首选标准规范命名: code.js / code.sh
  const candidates = ['code.js', 'code.sh', 'main.js', 'solution.js', 'index.js', 'main.sh', 'solution.sh', 'index.sh', 'main.c', 'main.py'];
  for (const cand of candidates) {
    const p = `${projectFolder}/${cand}`;
    const n = vfs.getNodeByPath(p);
    if (n && n.type === 'file') {
      return { path: p, content: n.content || '', name: cand };
    }
  }

  // 遍历寻找第一个非 test 脚本文件
  const dirNode = vfs.getNodeByPath(projectFolder);
  if (dirNode && dirNode.children) {
    for (const [name, child] of dirNode.children.entries()) {
      if (child.type === 'file' && !name.includes('test') && !name.endsWith('.md')) {
        return { path: `${projectFolder}/${name}`, content: child.content || '', name };
      }
    }
  }

  return null;
}

// 辅助运行测试引擎（Shell / JS via ECC Test Engine）
async function runLabTests(ctx: ExecutionContext, projectFolder: string): Promise<{ score: number; passed: boolean; logs: string; total: number; passedCount: number }> {
  // 检测测试文件
  const testJsNode = ctx.vfs.getNodeByPath(`${projectFolder}/test.js`);
  const testShNode = ctx.vfs.getNodeByPath(`${projectFolder}/test.sh`);

  if (testJsNode && testJsNode.type === 'file') {
    const { EccTestEngine } = await import('../eccTestEngine');
    const outcome = await EccTestEngine.runTestCode(testJsNode.content || '', ctx, { cwd: projectFolder });
    return {
      score: outcome.score,
      passed: outcome.failed === 0 && outcome.total > 0,
      logs: outcome.logs,
      total: outcome.total,
      passedCount: outcome.passed,
    };
  } else if (testShNode && testShNode.type === 'file') {
    const { BatsTestEngine } = await import('../batsTestEngine');
    const outcome = await BatsTestEngine.runBatsScript(testShNode.content || '', ctx, { cwd: projectFolder });
    return {
      score: outcome.score,
      passed: outcome.failed === 0 && outcome.total > 0,
      logs: outcome.logs,
      total: outcome.total,
      passedCount: outcome.passed,
    };
  }

  // 没有测试文件
  return {
    score: 100,
    passed: true,
    logs: `\x1b[33m[提示]\x1b[0m 未在项目目录中发现 test.js 或 test.sh，跳过自动化用例验证。\n`,
    total: 1,
    passedCount: 1,
  };
}

export const lmsCommands: Command[] = [
  {
    name: 'lms',
    description: 'Tangram LMS 学习管理系统实验集成 CLI 工具',
    category: 'net',
    execute: async (ctx: ExecutionContext): Promise<ExecutionResult> => {
      const subCommand = ctx.args[0]?.toLowerCase();
      const config = parseLmsConfig(ctx.vfs);

      if (!subCommand || subCommand === 'help' || subCommand === '--help' || subCommand === '-h') {
        return {
          stdout: [
            '\x1b[1;36mTangram LMS 实验交互命令行工具 (Earendel CLI)\x1b[0m',
            '用法: lms <command> [arguments]',
            '',
            '核心命令:',
            '  pull            拉取实验文档、初始代码模板与测试用例至 ~/project_id 目录',
            '  test            随时运行本地测试沙箱（Shell / JS），验证代码正确性',
            '  save [file]     暂存当前实验代码进度至 LMS 云端 (防止丢失)',
            '  commit [file]   运行单元测试并提交最终实验成果与评分',
            '  status          查看实验课题名称、截止时间、提交状态与成绩',
            '  whoami          检验当前 Token 有效性并查看当前登录学生信息',
            '  config          查看当前 /etc/lms.conf 的配置信息',
            '',
            '参数选项:',
            '  -h, --help      显示本帮助信息',
          ].join('\n') + '\n',
          stderr: '',
          exitCode: 0,
        };
      }

      if (subCommand === 'config') {
        return {
          stdout: [
            '\x1b[1;34m[LMS Configuration (/etc/lms.conf)]\x1b[0m',
            `  LMS_BASE_URL : ${config.baseUrl}`,
            `  PROJECT_ID   : ${config.projectId || '\x1b[33m(Not set)\x1b[0m'}`,
            `  ISSUE_ID     : ${config.issueId || '\x1b[33m(Not set)\x1b[0m'}`,
            `  TOKEN        : ${config.token ? `${config.token.slice(0, 16)}...` : '\x1b[33m(Not set)\x1b[0m'}`,
          ].join('\n') + '\n',
          stderr: '',
          exitCode: 0,
        };
      }

      // ==========================
      // 1. whoami: 身份核对
      // ==========================
      if (subCommand === 'whoami') {
        try {
          const user = await lmsRequest(config, '/api/external/me');
          if (!user || user.error || !user.id) {
            return {
              stdout: '',
              stderr: `lms: 身份检验失败: ${user?.message || 'Token 无效或已过期'}\n`,
              exitCode: 1,
            };
          }
          return {
            stdout: [
              '\x1b[1;32m[LMS 用户身份认证信息]\x1b[0m',
              `  学号 / 账号 : ${user.username || user.identity_number || 'N/A'}`,
              `  姓名        : ${user.name || 'N/A'}`,
              `  用户角色    : ${user.role || 'student'}`,
              `  所属机构 ID : ${user.org_id || 'N/A'}`,
            ].join('\n') + '\n',
            stderr: '',
            exitCode: 0,
          };
        } catch (e: any) {
          return {
            stdout: '',
            stderr: `lms whoami 失败: ${e?.message || e}\n`,
            exitCode: 1,
          };
        }
      }

      // ==========================
      // 2. pull: 拉取实验
      // ==========================
      if (subCommand === 'pull') {
        // 在用户主动 pull 时按需解析 URL 参数，保持 OS 内核初始化纯净
        let urlProjectId = '';
        let urlIssueId = '';
        let urlToken = '';
        if (typeof window !== 'undefined' && window.location) {
          try {
            const urlParams = new URLSearchParams(window.location.search);
            urlProjectId = urlParams.get('project_id') || '';
            urlIssueId = urlParams.get('issue_id') || '';
            urlToken = urlParams.get('token') || '';
          } catch (e) {
            // fallback
          }
        }

        const finalProjectId = urlProjectId || config.projectId;
        const finalIssueId = urlIssueId || config.issueId;
        const finalToken = urlToken || config.token;
        const finalBaseUrl = config.baseUrl || 'https://edu.tangram.techarts.cn';

        // 写入 /etc/lms.conf
        const lmsConfContent = [
          `LMS_BASE_URL=${finalBaseUrl}`,
          `PROJECT_ID=${finalProjectId}`,
          `ISSUE_ID=${finalIssueId}`,
          `TOKEN=${finalToken}`,
        ].join('\n') + '\n';

        ctx.vfs.writeFile('/etc/lms.conf', lmsConfContent);
        ctx.vfs.chmod('/etc/lms.conf', 'rw-r--r--');

        config.baseUrl = finalBaseUrl;
        config.projectId = finalProjectId;
        config.issueId = finalIssueId;
        config.token = finalToken;

        if (!config.issueId) {
          return {
            stdout: '',
            stderr: 'lms: 错误: 未检测到 ISSUE_ID。请检查 URL 参数或 /etc/lms.conf。\n',
            exitCode: 1,
          };
        }

        try {
          const labData = await lmsRequest(config, `/api/external/labs/${config.issueId}`);
          if (!labData || labData.error) {
            return {
              stdout: '',
              stderr: `lms: 获取实验失败: ${labData?.message || '未知错误'}\n`,
              exitCode: 1,
            };
          }

          const actualProjectId = labData.project?.id || config.projectId || `lab-${config.issueId}`;
          const projectFolder = `/home/hello/${actualProjectId}`;
          ctx.vfs.mkdir(projectFolder, true);

          // 更新配置中的 project_id（如果后端有返回最新的 project.id）
          if (labData.project?.id && labData.project.id !== config.projectId) {
            config.projectId = labData.project.id;
            const updatedConf = [
              `LMS_BASE_URL=${config.baseUrl}`,
              `PROJECT_ID=${config.projectId}`,
              `ISSUE_ID=${config.issueId}`,
              `TOKEN=${config.token}`,
            ].join('\n') + '\n';
            ctx.vfs.writeFile('/etc/lms.conf', updatedConf);
          }

          // 1. 写入实验说明 README.md
          if (labData.name || labData.content) {
            const readmeContent = `# ${labData.name || '实验任务'}\n\n${labData.content || ''}\n`;
            ctx.vfs.writeFile(`${projectFolder}/README.md`, readmeContent);
          }

          // 2. 写入实验初始模板代码 / 逻辑 (统一命名为 code.js / code.sh)
          const rawLogic = labData.project?.logic || labData.template || '';
          if (rawLogic && typeof rawLogic === 'string' && rawLogic.trim().length > 0) {
            // 自动检测默认代码文件名: Shell 模板落地为 code.sh，其他默认统一为 code.js
            const isShellScript = rawLogic.includes('#!/bin/bash') || rawLogic.includes('#!/bin/sh');
            const fileName = isShellScript ? 'code.sh' : 'code.js';
            ctx.vfs.writeFile(`${projectFolder}/${fileName}`, rawLogic);
            if (isShellScript) {
              ctx.vfs.chmod(`${projectFolder}/${fileName}`, 'rwxr-xr-x');
            }
          } else if (rawLogic && typeof rawLogic === 'object') {
            // 如果是多文件映射
            for (const [k, v] of Object.entries(rawLogic)) {
              const targetFilePath = `${projectFolder}/${k}`;
              ctx.vfs.writeFile(targetFilePath, String(v));
            }
          }

          // 3. 提取并写入自动化测试脚本 (test_code 字段纯文本)
          const rawTestCode = labData.test_code || '';
          if (rawTestCode && typeof rawTestCode === 'string' && rawTestCode.trim().length > 0) {
            // 判断是 JS 测试还是 Shell/Bats 测试
            const isShellTest = rawTestCode.includes('#!/usr/bin/env bats') || rawTestCode.includes('#!/bin/bash') || rawTestCode.includes('test_case') || rawTestCode.includes('@test');
            const testFileName = isShellTest ? 'test.sh' : 'test.js';
            const testFilePath = `${projectFolder}/${testFileName}`;

            ctx.vfs.writeFile(testFilePath, rawTestCode);
            // 核心安全防篡改：测试脚本强制设置为只读 (chmod 0444)
            ctx.vfs.chmod(testFilePath, isShellTest ? 'r-xr-xr-x' : 'r--r--r--');
          }

          // 确保所有测试文件均受只读保护
          if (ctx.vfs.getNodeByPath(`${projectFolder}/test.js`)) {
            ctx.vfs.chmod(`${projectFolder}/test.js`, 'r--r--r--');
          }
          if (ctx.vfs.getNodeByPath(`${projectFolder}/test.sh`)) {
            ctx.vfs.chmod(`${projectFolder}/test.sh`, 'r-xr-xr-x');
          }

          return {
            stdout: [
              `\x1b[1;32m✔ 成功拉取实验: ${labData.name || `#${config.issueId}`}\x1b[0m`,
              `  实验课题   : ${labData.name || 'N/A'}`,
              `  截止时间   : ${labData.deadline ? new Date(labData.deadline).toLocaleString() : '无截止时间'}`,
              `  工作目录   : \x1b[36m${projectFolder}\x1b[0m`,
              '',
              `💡 提示: 请执行 \x1b[33mcd ${projectFolder}\x1b[0m 查看代码与 README.md 开始实验！`,
              `💡 验证: 随时输入 \x1b[33mlms test\x1b[0m 检验代码，完成后执行 \x1b[33mlms commit\x1b[0m 提交！`,
            ].join('\n') + '\n',
            stderr: '',
            exitCode: 0,
          };
        } catch (e: any) {
          return {
            stdout: '',
            stderr: `lms pull 失败: ${e?.message || e}\n`,
            exitCode: 1,
          };
        }
      }

      // ==========================
      // 3. status: 查看状态与得分
      // ==========================
      if (subCommand === 'status') {
        if (!config.issueId) {
          return {
            stdout: '',
            stderr: 'lms: 错误: 未检测到 ISSUE_ID。请检查 /etc/lms.conf 或先执行 lms pull。\n',
            exitCode: 1,
          };
        }

        try {
          const labData = await lmsRequest(config, `/api/external/labs/${config.issueId}`);
          if (!labData || labData.error) {
            return {
              stdout: '',
              stderr: `lms: 获取状态失败: ${labData?.message || '未知错误'}\n`,
              exitCode: 1,
            };
          }

          const statusMap: Record<string, string> = {
            unreceived: '未接收 (Unreceived)',
            received: '进行中 (In Progress)',
            submitted: '已提交待批改 (Submitted)',
            graded: '已完成/已评分 (Graded)',
          };

          const statusText = statusMap[labData.status] || labData.status || '进行中';
          const scoreDisplay = labData.score !== null && labData.score !== undefined ? `\x1b[1;32m${labData.score} 分\x1b[0m` : '\x1b[33m暂无评分\x1b[0m';

          return {
            stdout: [
              '\x1b[1;34m[LMS 实验当前状态]\x1b[0m',
              `  实验名称   : ${labData.name || 'N/A'}`,
              `  课题编号   : Issue #${labData.issue_id || config.issueId}`,
              `  实验状态   : ${statusText}`,
              `  当前得分   : ${scoreDisplay}`,
              `  截止时间   : ${labData.deadline ? new Date(labData.deadline).toLocaleString() : '无截止时间限制'}`,
              `  逾期惩罚   : ${labData.late_penalty_per_day ? `每天扣除 ${labData.late_penalty_per_day}%` : '无逾期扣分'}`,
            ].join('\n') + '\n',
            stderr: '',
            exitCode: 0,
          };
        } catch (e: any) {
          return {
            stdout: '',
            stderr: `lms status 失败: ${e?.message || e}\n`,
            exitCode: 1,
          };
        }
      }

      // ==========================
      // 4. save: 暂存进度
      // ==========================
      if (subCommand === 'save') {
        if (!config.projectId) {
          return {
            stdout: '',
            stderr: 'lms: 错误: 未配置 PROJECT_ID。请检查 /etc/lms.conf。\n',
            exitCode: 1,
          };
        }

        const projectFolder = `/home/hello/${config.projectId}`;
        const targetFile = ctx.args[1];
        const mainFile = findMainCodeFile(ctx.vfs, projectFolder, targetFile);

        if (!mainFile) {
          return {
            stdout: '',
            stderr: `lms: 未在 ${projectFolder} 中找到可保存的代码文件。\n`,
            exitCode: 1,
          };
        }

        try {
          const res = await lmsRequest(config, `/api/external/projects/${config.projectId}`, 'PUT', {
            logic: mainFile.content,
            source: `Earendel WebOS 暂存 (${mainFile.name})`,
          });

          if (res && res.error) {
            return {
              stdout: '',
              stderr: `lms: 暂存失败: ${res.message || '未知错误'}\n`,
              exitCode: 1,
            };
          }

          return {
            stdout: `\x1b[32m✔ 实验进度已成功保存至 LMS 云端！[文件: ${mainFile.name}]\x1b[0m\n`,
            stderr: '',
            exitCode: 0,
          };
        } catch (e: any) {
          return {
            stdout: '',
            stderr: `lms save 失败: ${e?.message || e}\n`,
            exitCode: 1,
          };
        }
      }

      // ==========================
      // 5. test: 本地沙箱测试
      // ==========================
      if (subCommand === 'test') {
        const projectFolder = config.projectId ? `/home/hello/${config.projectId}` : `/home/hello/lab-${config.issueId}`;
        const node = ctx.vfs.getNodeByPath(projectFolder);
        if (!node) {
          return {
            stdout: '',
            stderr: `lms: 未找到实验目录 ${projectFolder}，请先执行 lms pull。\n`,
            exitCode: 1,
          };
        }

        const result = await runLabTests(ctx, projectFolder);
        return {
          stdout: [
            `\x1b[1;34m[LMS 单元测试执行结果]\x1b[0m`,
            result.logs,
            `  测试通过 : ${result.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`,
            `  预估得分 : \x1b[1;33m${result.score}/100\x1b[0m`,
          ].join('\n') + '\n',
          stderr: '',
          exitCode: result.passed ? 0 : 1,
        };
      }

      // ==========================
      // 6. commit: 运行测试并最终提交
      // ==========================
      if (subCommand === 'commit') {
        if (!config.issueId || !config.projectId) {
          return {
            stdout: '',
            stderr: 'lms: 错误: 未配置 ISSUE_ID 或 PROJECT_ID。请检查 /etc/lms.conf。\n',
            exitCode: 1,
          };
        }

        const projectFolder = `/home/hello/${config.projectId}`;
        const targetFile = ctx.args[1];
        const mainFile = findMainCodeFile(ctx.vfs, projectFolder, targetFile);

        if (!mainFile) {
          return {
            stdout: '',
            stderr: `lms: 未在 ${projectFolder} 中找到可提交的代码文件。\n`,
            exitCode: 1,
          };
        }

        // 1. 先跑本地测试验证
        const testOutcome = await runLabTests(ctx, projectFolder);

        // 2. 发起提交请求
        try {
          const submitPayload = {
            project_id: config.projectId,
            logic: mainFile.content,
            score: testOutcome.score,
            test_result: testOutcome.passed ? 1 : 0,
            auto_score_detail: {
              total_tests: testOutcome.total,
              passed_tests: testOutcome.passedCount,
              logs: testOutcome.logs,
            },
            report_content: `通过 Earendel WebOS 终端自动评分提交 (得分: ${testOutcome.score})`,
          };

          const res = await lmsRequest(config, `/api/external/labs/${config.issueId}/submit`, 'POST', submitPayload);

          if (!res || res.error) {
            return {
              stdout: testOutcome.logs + '\n',
              stderr: `lms: 实验提交失败: ${res?.message || '未知服务器错误'}\n`,
              exitCode: 1,
            };
          }

          return {
            stdout: [
              testOutcome.logs,
              '\x1b[1;32m🎉 实验已成功提交并自动评分完成！\x1b[0m',
              `  最终得分 : \x1b[1;32m${res.score ?? testOutcome.score} 分\x1b[0m (原始得分: ${res.raw_score ?? testOutcome.score}, 扣分: ${res.penalty ?? 0})`,
              `  归档状态 : ${res.status || 'graded'}`,
              `  服务器消息 : ${res.message || 'OK'}`,
            ].join('\n') + '\n',
            stderr: '',
            exitCode: 0,
          };
        } catch (e: any) {
          return {
            stdout: testOutcome.logs + '\n',
            stderr: `lms commit 失败: ${e?.message || e}\n`,
            exitCode: 1,
          };
        }
      }

      return {
        stdout: '',
        stderr: `lms: 未知子命令 "${subCommand}". 使用 "lms help" 查看可用命令。\n`,
        exitCode: 1,
      };
    },
  },
];

