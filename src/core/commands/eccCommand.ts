// Earendel & ECMA Compiler Collection Toolchain (ecc)
import { Command } from '../types';

function resolvePath(basePath: string, relPath: string): string {
  if (!relPath.startsWith('.')) return relPath;
  const dir = basePath.substring(0, basePath.lastIndexOf('/')) || '/';
  const rawPath = dir === '/' ? `/${relPath}` : `${dir}/${relPath}`;
  const parts = rawPath.split('/').filter(Boolean);
  const stack: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }

  let res = '/' + stack.join('/');
  const hasExt = /\.[a-zA-Z0-9]+$/.test(res);
  if (!hasExt) {
    res += '.js';
  }
  return res;
}

function stripJsComments(code: string): string {
  let out = '';
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (lineComment) {
      if (ch === '\n' || ch === '\r') { lineComment = false; out += ch; }
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      else if (ch === '\n' || ch === '\r') out += ch;
      continue;
    }
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    out += ch;
  }
  return out;
}

function minifyCode(code: string): string {
  // Conservative O2 pass: remove comments only; preserve all token and literal whitespace.
  return stripJsComments(code);
}

function transpileESMToCommonJS(code: string, currentPath: string = ''): { code: string; exportedSymbols: string[] } {
  let result = stripJsComments(code.replace(/^\uFEFF/, '').replace(/^#!.*$/m, '')).trim();

  // 1. If file is a .json file, wrap as module.exports
  if (currentPath.endsWith('.json')) {
    return {
      code: `module.exports = ${result};\nexports.default = module.exports;`,
      exportedSymbols: ['default'],
    };
  }

  const exportedSymbols: string[] = [];

  // 2. Uniform Export Default Transpilation (`export default ...`)
  if (/(^|[;\n])[ \t]*export\s+default\s+/.test(result)) {
    exportedSymbols.push('default');
    result = result.replace(/(^|[;\n])([ \t]*)export\s+default\s+/g, '$1$2exports.default = ');
  }

  // 3. Re-exports: `export * from './mod'`
  result = result.replace(/(^|[;\n])[ \t]*export\s*\*\s*from\s*(['"])([^'"\n]+)\2\s*;?/g, (_m, prefix, _quote, modPath) => {
    return `${prefix}Object.assign(exports, __require__(${JSON.stringify(modPath)}));`;
  });

  // 4. Re-exports & Named Exports: `export { a, b as c }` or `export { a } from './mod'`
  result = result.replace(/(^|[;\n])[ \t]*export\s*\{([^}]+)\}(?:\s*from\s*(['"])([^'"\n]+)\3)?\s*;?/g, (_m, prefix, items, _quote, modPath) => {
    const list = items.split(',').map((s: string) => s.trim()).filter(Boolean);
    const reqStr = modPath ? `__require__(${JSON.stringify(modPath)})` : '';

    const stmts = list.map((item: string) => {
      const parts = item.split(/\s+as\s+/);
      const localName = parts[0].trim();
      const exportName = parts[1] ? parts[1].trim() : localName;
      exportedSymbols.push(exportName);

      if (modPath) {
        return `exports[${JSON.stringify(exportName)}] = ${reqStr}[${JSON.stringify(localName)}];`;
      } else {
        return `exports[${JSON.stringify(exportName)}] = ${localName};`;
      }
    });

    return `${prefix}${stmts.join('\n')}`;
  });

  // 5. `export (const|let|var|function|class) name`
  const exportDeclRegex = /export\s+(const|let|var|function|class)\s+([a-zA-Z0-9_$]+)/g;
  let match;
  while ((match = exportDeclRegex.exec(stripJsComments(code))) !== null) {
    const name = match[2];
    if (!exportedSymbols.includes(name)) {
      exportedSymbols.push(name);
    }
  }
  result = result.replace(/(^|[;\n])([ \t]*)export\s+(const|let|var|function|class)\s+([a-zA-Z0-9_$]+)/g, '$1$2$3 $4');

  // Append export assignments for all named exports
  const exportAssignments = exportedSymbols
    .filter((s) => s !== 'default')
    .map((s) => `try { if (typeof ${s} !== 'undefined') exports.${s} = ${s}; } catch (_) {}`)
    .join('\n');

  if (exportAssignments) {
    result += '\n' + exportAssignments;
  }

  // 6. Import statements
  result = result.replace(/(^|[;\n])[ \t]*import\s+([a-zA-Z_$][\w$]*)\s*,\s*\{([^}]+)\}\s*from\s*(['"])([^'"\n]+)\4\s*;?/g, (_m, prefix, def, named, _quote, modPath) => {
    const required = `__require__(${JSON.stringify(modPath)})`;
    const namedReq = named.split(',').map((n: string) => n.trim()).filter(Boolean).map((n: string) => {
      const [imported, local] = n.split(/\s+as\s+/).map((part) => part.trim());
      return `const ${local || imported} = ${required}[${JSON.stringify(imported)}];`;
    }).join(' ');
    return `${prefix}const ${def} = Object.prototype.hasOwnProperty.call(${required}, 'default') ? ${required}.default : ${required}; ${namedReq}`;
  });

  result = result.replace(/(^|[;\n])[ \t]*import\s*\{([^}]+)\}\s*from\s*(['"])([^'"\n]+)\3\s*;?/g, (_m, prefix, named, _quote, modPath) => {
    const required = `__require__(${JSON.stringify(modPath)})`;
    return `${prefix}${named.split(',').map((n: string) => n.trim()).filter(Boolean).map((n: string) => {
      const [imported, local] = n.split(/\s+as\s+/).map((part) => part.trim());
      return `const ${local || imported} = ${required}[${JSON.stringify(imported)}];`;
    }).join(' ')}`;
  });

  result = result.replace(/(^|[;\n])[ \t]*import\s+([a-zA-Z_$][\w$]*)\s+from\s*(['"])([^'"\n]+)\3\s*;?/g, (_m, prefix, def, _quote, modPath) => {
    const required = `__require__(${JSON.stringify(modPath)})`;
    return `${prefix}const ${def} = Object.prototype.hasOwnProperty.call(${required}, 'default') ? ${required}.default : ${required};`;
  });

  result = result.replace(/(^|[;\n])[ \t]*import\s*\*\s*as\s+([a-zA-Z_$][\w$]*)\s+from\s*(['"])([^'"\n]+)\3\s*;?/g, (_m, prefix, ns, _quote, modPath) => {
    return `${prefix}const ${ns} = __require__(${JSON.stringify(modPath)});`;
  });

  result = result.replace(/(^|[;\n])[ \t]*import\s*(['"])([^'"\n]+)\2\s*;?/g, (_m, prefix, _quote, modPath) => {
    return `${prefix}__require__(${JSON.stringify(modPath)});`;
  });

  return { code: result, exportedSymbols };
}

export const eccCommand: Command = {
  name: 'ecc',
  description: 'ECMA Compiler Collection: statically bundle JavaScript modules into EAF executables',
  category: 'sys',
  execute: async (ctx) => {
    let outputFile = 'a.out.eaf';
    let inputFile = '';
    const embedsMap: Record<string, string> = {};
    const embedErrors: string[] = [];

    const isO2 = ctx.args.includes('-O2') || ctx.args.includes('-O');
    const isStrip = ctx.args.includes('-s') || ctx.args.includes('--strip');
    const isWasm = ctx.args.includes('--target=wasm');

    const args = ctx.args;
    const subCmd = args[0]?.toLowerCase();

    // 1. ecc test: Native Test Suite Subcommand
    if (subCmd === 'test') {
      const { EccTestEngine } = await import('../eccTestEngine');
      let targetFile = args[1];
      if (!targetFile) {
        // 自动探测当前目录下的 test.js
        if (ctx.vfs.getNodeByPath('test.js')) {
          targetFile = 'test.js';
        }
      }

      if (!targetFile) {
        return {
          stdout: '',
          stderr: 'ecc: error: no test file specified. Usage: ecc test <test_file.js>\n',
          exitCode: 1,
        };
      }

      const absPath = ctx.vfs.resolvePath(targetFile);
      const node = ctx.vfs.getNodeByPath(absPath);
      if (!node || node.type !== 'file' || !ctx.vfs.checkPermission(node, 'r', ctx.env['USER'] || 'hello')) {
        return {
          stdout: '',
          stderr: `ecc: error: cannot read test file '${targetFile}'.\n`,
          exitCode: 1,
        };
      }

      const cwd = absPath.substring(0, absPath.lastIndexOf('/')) || '/home/hello';
      const outcome = await EccTestEngine.runTestCode(node.content || '', ctx, { cwd });
      return {
        stdout: outcome.logs + '\n',
        stderr: '',
        exitCode: outcome.exitCode,
      };
    }

    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
      return {
        stdout: [
          `\x1b[1;36m[ecc] ECMA Compiler Collection Toolchain v1.0.0\x1b[0m`,
          `Usage:`,
          `  ecc <input.js> -o <output.eaf> [options]   (Compile & Link into EAF executable)`,
          `  ecc -s <input.eaf> [-o <output.eaf>]       (Strip EAF symbol table; default: in place)`,
          `  ecc test <test.js>                         (Run native ECMA test suite)`,
          ``,
          `Compiler Options:`,
          `  -o <output>        Specify output executable name`,
          `  -O2                Remove comments while preserving JavaScript literals`,
          `  -s, --strip        Strip .symtab while compiling JS, or from an existing EAF`,
          `  --embed <file|dir> Inline a file or directory tree into .data.embeds`,
          `  --target=wasm      Reserved; reports an error until a WASM backend exists`,
          `  -v, --version      Display toolchain version and target`,
        ].join('\n') + '\n',
        stderr: '',
        exitCode: 0,
      };
    }

    if (args.includes('-v') || args.includes('--version')) {
      return { stdout: 'ecc (Earendel ECMA Compiler Collection) 1.0.0\ntarget: js-vm\n', stderr: '', exitCode: 0 };
    }
    if (isWasm) {
      return { stdout: '', stderr: 'ecc: error: --target=wasm is not implemented; refusing to emit JavaScript labeled as WebAssembly\n', exitCode: 1 };
    }

    let idx = 0;
    while (idx < ctx.args.length) {
      const arg = ctx.args[idx];
      if (arg === '-o') {
        const target = ctx.args[idx + 1];
        if (target) {
          outputFile = target.endsWith('.eaf') ? target : `${target}.eaf`;
        }
        idx += 2;
      } else if (arg === '--embed') {
        const embedTarget = ctx.args[idx + 1];
        if (embedTarget) {
          const embedAbs = ctx.vfs.resolvePath(embedTarget);
          const embedNode = ctx.vfs.getNodeByPath(embedAbs);
          if (!embedNode || !ctx.vfs.checkPermission(embedNode, 'r', ctx.env['USER'] || 'hello')) {
            embedErrors.push(`ecc: error: embedded asset '${embedTarget}' not found or unreadable`);
          } else if (embedNode.type === 'file') {
            embedsMap[embedTarget] = embedNode.content || '';
          } else if (embedNode.type === 'directory' && embedNode.children) {
            const collect = (node: typeof embedNode, nodePath: string, relativePath: string) => {
              if (!ctx.vfs.checkPermission(node, 'r', ctx.env['USER'] || 'hello')) {
                embedErrors.push(`ecc: error: embedded asset '${nodePath}' is unreadable`);
                return;
              }
              if (node.type === 'file') embedsMap[relativePath] = node.content || '';
              if (node.type === 'directory' && node.children) {
                for (const child of node.children.values()) {
                  collect(child, `${nodePath}/${child.name}`, `${relativePath}/${child.name}`);
                }
              }
            };
            for (const child of embedNode.children.values()) collect(child, `${embedAbs}/${child.name}`, `${embedTarget}/${child.name}`);
          } else {
            embedErrors.push(`ecc: error: unsupported asset type '${embedTarget}'`);
          }
        }
        idx += 2;
      } else if (arg.startsWith('-')) {
        idx++;
      } else {
        if (!inputFile) {
          inputFile = arg;
        }
        idx++;
      }
    }

    if (!inputFile) {
      return { stdout: '', stderr: 'ecc: fatal error: no input files\ncompilation terminated.\nUsage: ecc -O2 -s --embed asset.json -o app.eaf main.js\n', exitCode: 1 };
    }
    if (embedErrors.length) return { stdout: '', stderr: `${embedErrors.join('\n')}\ncompilation terminated.\n`, exitCode: 1 };

    const supportedOptions = new Set(['-o', '--embed', '-O', '-O2', '-s', '--strip']);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('-') && !supportedOptions.has(arg)) {
        return { stdout: '', stderr: `ecc: error: unrecognized option '${arg}'\n`, exitCode: 1 };
      }
      if ((arg === '-o' || arg === '--embed') && (!args[i + 1] || args[i + 1].startsWith('-'))) {
        return { stdout: '', stderr: `ecc: error: option '${arg}' requires an argument\n`, exitCode: 1 };
      }
    }

    const entryAbsPath = ctx.vfs.resolvePath(inputFile);
    const entryNode = ctx.vfs.getNodeByPath(entryAbsPath);
    if (!entryNode || entryNode.type !== 'file' || !ctx.vfs.checkPermission(entryNode, 'r', ctx.env['USER'] || 'hello')) {
      return { stdout: '', stderr: `ecc: error: ${inputFile}: No such file or directory\n`, exitCode: 1 };
    }

    // `ecc -s app.eaf` strips an existing EAF in place. Supplying -o writes
    // the stripped package to a separate path. Keep JS compilation behavior
    // unchanged when the input is a JavaScript source file.
    if (inputFile.toLowerCase().endsWith('.eaf')) {
      if (!isStrip) {
        return {
          stdout: '',
          stderr: `ecc: error: '${inputFile}' is already an EAF executable; use './${inputFile}' to run it or 'ecc -s ${inputFile}' to strip its symbol table\n`,
          exitCode: 1,
        };
      }
      if (isO2 || args.includes('--embed')) {
        return {
          stdout: '',
          stderr: 'ecc: error: -O2 and --embed apply only when compiling JavaScript source files\n',
          exitCode: 1,
        };
      }

      let eafPayload: any;
      try {
        eafPayload = JSON.parse(entryNode.content || '');
      } catch {
        return { stdout: '', stderr: `ecc: error: '${inputFile}' is not a valid EAF file (invalid JSON)\n`, exitCode: 1 };
      }
      if (eafPayload?.magic !== 'EAF01' || !eafPayload.sections || typeof eafPayload.sections !== 'object') {
        return { stdout: '', stderr: `ecc: error: '${inputFile}' is not a valid EAF executable\n`, exitCode: 1 };
      }

      delete eafPayload.sections['.symtab'];
      const strippedOutput = args.includes('-o') ? outputFile : inputFile;
      const currentUser = ctx.env['USER'] || 'hello';
      const strippedContent = JSON.stringify(eafPayload, null, 2);
      if (!ctx.vfs.writeFile(strippedOutput, strippedContent, currentUser)) {
        return { stdout: '', stderr: `ecc: error: cannot write stripped EAF '${strippedOutput}' (permission denied or parent directory missing)\n`, exitCode: 1 };
      }
      if (!ctx.vfs.chmod(strippedOutput, '755', false, currentUser)) {
        return { stdout: '', stderr: `ecc: error: cannot set executable permissions on '${strippedOutput}'\n`, exitCode: 1 };
      }
      return {
        stdout: `[ecc] Stripped symbol table (.symtab) from '${inputFile}'.\n  Output EAF: ${strippedOutput}\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    const modulesMap: Record<string, string> = {};
    const visited = new Set<string>();
    const symtab: Array<{ symbol: string; module: string; type: string }> = [];
    const compileErrors: string[] = [];

    // Golang-style Static Dependency Graph Traversal & Tree Shaking Pass
    const visitModule = (currentPath: string) => {
      if (visited.has(currentPath)) return;
      visited.add(currentPath);

      const node = ctx.vfs.getNodeByPath(currentPath);
      if (!node || node.type !== 'file' || !ctx.vfs.checkPermission(node, 'r', ctx.env['USER'] || 'hello')) {
        compileErrors.push(`ecc: error: module '${currentPath}' not found in VFS`);
        return;
      }

      const rawCode = node.content || '';
      const { code: transpiledCode, exportedSymbols } = transpileESMToCommonJS(rawCode, currentPath);

      // Record Symbol Table Entries
      exportedSymbols.forEach((sym) => {
        symtab.push({ symbol: sym, module: currentPath, type: 'export' });
      });

      // Apply -O2 Code Minification if requested
      const finalCode = isO2 ? minifyCode(transpiledCode) : transpiledCode;
      modulesMap[currentPath] = finalCode;

      // Strip comments before scanning dependencies to avoid matching commented-out imports
      const cleanRawCode = stripJsComments(rawCode);

      // Scan for sub-dependencies
      const importRegex = /(?:import|require)\s*(?:[^'"]*from\s*)?['"]([^'"]+)['"]/g;
      if (/\bimport\s*\(/.test(cleanRawCode)) {
        compileErrors.push(`ecc: error: dynamic import() is not supported by the static linker in '${currentPath}'`);
      }
      if (/\brequire\s*\(\s*(?!['"])/.test(cleanRawCode)) {
        compileErrors.push(`ecc: error: dynamic require() cannot be statically linked in '${currentPath}'`);
      }
      let match;
      while ((match = importRegex.exec(cleanRawCode)) !== null) {
        const importTarget = match[1];
        if (importTarget.startsWith('.')) {
          const subAbsPath = resolvePath(currentPath, importTarget);
          visitModule(subAbsPath);
        } else {
          compileErrors.push(`ecc: error: unsupported external module '${importTarget}' imported by '${currentPath}'`);
        }
      }
    };

    visitModule(entryAbsPath);

    if (compileErrors.length > 0) {
      return { stdout: '', stderr: compileErrors.join('\n') + '\ncompilation terminated.\n', exitCode: 1 };
    }

    // Golang-style Self-Contained IIFE Static Bundle Generator
    const moduleDefs = Object.entries(modulesMap)
      .map(([modPath, code]) => `  ${JSON.stringify(modPath)}: function(exports, __require__, module) {\n${code}\n  }`)
      .join(',\n');

    let bundledTextCode = [
      `(function() {`,
      `  var __modules__ = {\n${moduleDefs}\n  };`,
      `  var __cache__ = {};`,
      `  function __resolve__(base, rel) {`,
      `    if (!rel.startsWith('.')) return rel;`,
      `    var dir = base.substring(0, base.lastIndexOf('/')) || '/';`,
      `    var rawPath = dir === '/' ? '/' + rel : dir + '/' + rel;`,
      `    var parts = rawPath.split('/').filter(Boolean);`,
      `    var stack = [];`,
      `    for (var i = 0; i < parts.length; i++) {`,
      `      if (parts[i] === '.' || parts[i] === '') continue;`,
      `      if (parts[i] === '..') { if (stack.length > 0) stack.pop(); }`,
      `      else stack.push(parts[i]);`,
      `    }`,
      `    var res = '/' + stack.join('/');`,
      `    var hasExt = /\\.[a-zA-Z0-9]+$/.test(res);`,
      `    if (!hasExt) res += '.js';`,
      `    return res;`,
      `  }`,
      `  function createRequire(currentModPath) {`,
      `    return function __require__(reqId) {`,
      `      var resolved = reqId.startsWith('.') ? __resolve__(currentModPath, reqId) : reqId;`,
      `      if (__cache__[resolved]) return __cache__[resolved].exports;`,
      `      var mod = __cache__[resolved] = { exports: {} };`,
      `      if (!__modules__[resolved]) throw new Error("ecc linker error: cannot find module '" + reqId + "' (resolved: '" + resolved + "')");`,
      `      var localReq = createRequire(resolved);`,
      `      __modules__[resolved](mod.exports, localReq, mod);`,
      `      return mod.exports;`,
      `    };`,
      `  }`,
      `  var entryReq = createRequire(${JSON.stringify(entryAbsPath)});`,
      `  return entryReq(${JSON.stringify(entryAbsPath)});`,
      `})()`,
    ].join('\n');

    if (isO2) {
      bundledTextCode = minifyCode(bundledTextCode);
    }

    // Create EAF Binary Format Object
    const eafPayload: any = {
      magic: 'EAF01',
      version: '1.0.0',
      header: {
        entry: entryAbsPath,
        type: 'EXEC',
        arch: isWasm ? 'wasm32' : 'js-vm',
        stackSizeKB: 64,
        heapSizeKB: 1048576,
        createdAt: new Date().toISOString(),
      },
      sections: {
        '.text': bundledTextCode,
        '.data': {
          appName: outputFile,
          compiledBy: isO2 ? 'ecc-v1.0-O2-opt' : 'ecc-v1.0-statically-linked',
          modulesCount: visited.size,
          embeds: embedsMap,
        },
        '.imports': ['eslib.sys.read', 'eslib.sys.write', 'eslib.sys.fork', 'eslib.io.printf', 'eslib.sys.getEmbed'],
      },
    };

    if (!isStrip) {
      eafPayload.sections['.symtab'] = symtab;
    }

    const binaryContent = JSON.stringify(eafPayload, null, 2);
    const currentUser = ctx.env['USER'] || 'hello';
    if (!ctx.vfs.writeFile(outputFile, binaryContent, currentUser)) {
      return { stdout: '', stderr: `ecc: error: cannot write output file '${outputFile}' (permission denied or parent directory missing)\n`, exitCode: 1 };
    }
    if (!ctx.vfs.chmod(outputFile, '755', false, currentUser)) {
      return { stdout: '', stderr: `ecc: error: cannot set executable permissions on '${outputFile}'\n`, exitCode: 1 };
    }

    const rawSize = new TextEncoder().encode(JSON.stringify(modulesMap)).length;
    const finalSize = new TextEncoder().encode(binaryContent).length;
    const embedCount = Object.keys(embedsMap).length;

    const out = [
      `\x1b[1;32m[ecc] ECMA Compiler Collection v1.0.0 (Industrial Compiler Suite)\x1b[0m`,
      `  Entry Source:    ${inputFile} (${entryAbsPath})`,
      `  Linked Modules:  \x1b[33m${visited.size} ESM modules statically linked\x1b[0m`,
      `  Embedded Assets: \x1b[36m${embedCount} assets inlined into .data.embeds\x1b[0m`,
      `  Optimization:    \x1b[32m${isO2 ? '-O2 Comment Removal (syntax-preserving)' : 'None (O0 Debug)'}\x1b[0m`,
      `  Symbol Table:    \x1b[90m${isStrip ? '.symtab stripped (-s)' : `.symtab included (${symtab.length} symbols)`}\x1b[0m`,
      `  Output EAF:      \x1b[1;36m${outputFile}\x1b[0m (Magic: EAF\\x01, Size: ${finalSize}B, +x)`,
      `\x1b[90mRun using: ./${outputFile}\x1b[0m\n`,
    ].join('\n');

    return { stdout: out, stderr: '', exitCode: 0 };
  },
};
