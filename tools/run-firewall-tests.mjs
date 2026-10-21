import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), 'earendel-firewall-'));
const entryPoint = join(projectRoot, 'tools', 'firewall.integration.ts');

try {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    rootDir: projectRoot,
    outDir,
    skipLibCheck: true,
    esModuleInterop: true,
  };
  const program = ts.createProgram([entryPoint], compilerOptions);
  // The app's main tsconfig/Vite alias setup is checked separately by `npm run build`.
  // This temporary CommonJS compilation only supplies executable modules for Node.
  const emitted = program.emit();
  if (emitted.emitSkipped) throw new Error('TypeScript could not emit the firewall test entry point');
  process.env.EARENDEL_FIREWALL_BUILD = outDir;
  await import('./firewall.test.mjs');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
