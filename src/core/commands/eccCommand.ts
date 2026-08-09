// Earendel C/JS Compiler Toolchain (ecc)
import { Command } from '../types';

export const eccCommand: Command = {
  name: 'ecc',
  description: 'Earendel C/JS Compiler toolchain for EAF binary executables',
  category: 'sys',
  execute: (ctx) => {
    const oIdx = ctx.args.indexOf('-o');
    let outputFile = 'a.out.eaf';
    let inputFile = '';

    if (oIdx !== -1 && ctx.args[oIdx + 1]) {
      outputFile = ctx.args[oIdx + 1];
      if (!outputFile.endsWith('.eaf')) {
        outputFile += '.eaf';
      }
    }

    const remainingArgs = ctx.args.filter((a, idx) => a !== '-o' && idx !== oIdx + 1 && !a.startsWith('--'));
    inputFile = remainingArgs[0] || '';

    if (!inputFile) {
      return { stdout: '', stderr: 'ecc: fatal error: no input files\ncompilation terminated.\nUsage: ecc -o app.eaf main.js\n', exitCode: 1 };
    }

    const inputNode = ctx.vfs.getNodeByPath(inputFile);
    if (!inputNode || inputNode.type !== 'file') {
      return { stdout: '', stderr: `ecc: error: ${inputFile}: No such file or directory\n`, exitCode: 1 };
    }

    const isWasm = ctx.args.includes('--target=wasm') || inputFile.endsWith('.wasm');
    const rawSource = inputNode.content || '';
    const sourceCode = rawSource
      .replace(/^\uFEFF/, '')
      .replace(/^#!.*$/m, '') // Strip Shebang line (#!/usr/bin/env node)
      .trim();

    // Create EAF Binary Format Object
    const eafPayload = {
      magic: 'EAF01',
      version: '1.0.0',
      header: {
        entry: 'main',
        type: 'EXEC',
        arch: isWasm ? 'wasm32' : 'js-vm',
        stackSizeKB: 64,
        heapSizeKB: 1048576,
        createdAt: new Date().toISOString(),
      },
      sections: {
        '.text': sourceCode,
        '.data': { appName: outputFile, compiledBy: 'ecc-v1.0' },
        '.imports': ['eslib.sys.read', 'eslib.sys.write', 'eslib.sys.fork', 'eslib.io.printf'],
      },
    };

    const binaryContent = JSON.stringify(eafPayload, null, 2);
    ctx.vfs.writeFile(outputFile, binaryContent);
    ctx.vfs.chmod(outputFile, 'rwxr-xr-x'); // Auto grant executable permissions (+x)

    const out = [
      `\x1b[1;32m[ecc] Earendel C/JS Compiler v1.0.0\x1b[0m`,
      `  Source File: ${inputFile}`,
      `  Target Arch: ${isWasm ? 'WASM32 Bytecode' : 'ECMAScript Virtual Machine (js-vm)'}`,
      `  Output EAF:  \x1b[1;36m${outputFile}\x1b[0m (Magic: EAF\\x01, +x Granted)`,
      `\x1b[90mRun using: ./${outputFile}\x1b[0m\n`,
    ].join('\n');

    return { stdout: out, stderr: '', exitCode: 0 };
  },
};
