import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createServer } from 'vite';

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

let failures = 0;
const report = async (name, operation) => {
  try {
    await operation();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}: ${error?.stack || error}`);
  }
};

try {
  const [{ BatsTestEngine }, { globalVFS, VirtualFileSystem }, { globalProcessManager }, { globalTaskScheduler }, { globalCapabilityManager }, { globalVMPageTable }, { SyscallNo }, { syscallAs, setSyscallTracer }, { globalCronEngine }, , , { findSuiteCommands }] = await Promise.all([
    server.ssrLoadModule('/src/core/batsTestEngine.ts'),
    server.ssrLoadModule('/src/core/vfs.ts'),
    server.ssrLoadModule('/src/core/processManager.ts'),
    server.ssrLoadModule('/src/kernel/taskScheduler.ts'),
    server.ssrLoadModule('/src/kernel/capability.ts'),
    server.ssrLoadModule('/src/kernel/vmPageTable.ts'),
    server.ssrLoadModule('/src/kernel/types.ts'),
    server.ssrLoadModule('/src/kernel/syscall.ts'),
    server.ssrLoadModule('/src/core/cronEngine.ts'),
    server.ssrLoadModule('/src/kernel/services/pmd.ts'),
    server.ssrLoadModule('/src/kernel/services/vfsd.ts'),
    server.ssrLoadModule('/src/core/commands/findSuiteCommands.ts'),
  ]);
  const { ShellEngine } = await server.ssrLoadModule('/src/core/shellEngine.ts');
  const { verifyAccountPassword, hashAccountPassword } = await server.ssrLoadModule('/src/core/accountAuth.ts');
  const { globalHostMountEngine } = await server.ssrLoadModule('/src/core/hostMountEngine.ts');
  const { userCommands } = await server.ssrLoadModule('/src/core/commands/userCommands.ts');
  const { globalJsEngine } = await server.ssrLoadModule('/src/core/jsRuntime.ts');
  const { runEafInWorker, EAF_WORKER_SOURCE } = await server.ssrLoadModule('/src/core/eafWorker.ts');

  const callerPid = 24;
  await report('fresh accounts authenticate and changed passwords use PBKDF2', async () => {
    assert.equal(await verifyAccountPassword(globalVFS, 'hello', '123456'), true);
    assert.equal(await verifyAccountPassword(globalVFS, 'root', '123456'), true);
    assert.equal(await verifyAccountPassword(globalVFS, 'hello', 'wrong-password'), false);
    assert.equal(await verifyAccountPassword(globalVFS, 'missing-user', '123456'), false);
    assert.equal(globalVFS.readFile('/etc/shadow', 'hello'), null);
    const rootHome = globalVFS.getNodeByPath('/root', 'root');
    assert.equal(rootHome?.owner, 'root');
    assert.equal(rootHome?.group, 'root');
    assert.equal(rootHome?.permissions, 'rwx------');
    assert.equal(globalVFS.writeFile('/root/.hello-must-not-write', 'blocked', 'hello'), false);
    const encoded = await hashAccountPassword('new classroom password');
    assert.match(encoded || '', /^pbkdf2-sha256\$310000\$/);
    const shadowProbe = { readFile: () => `probe:${encoded}:19000:0:99999:7:::\n` };
    assert.equal(await verifyAccountPassword(shadowProbe, 'probe', 'new classroom password'), true);
    assert.equal(await verifyAccountPassword(shadowProbe, 'probe', 'wrong password'), false);
  });
  await report('fresh classroom accounts recover Linux locked shadow credentials', async () => {
    const vfs = new VirtualFileSystem();
    assert.equal(vfs.writeFile('/etc/shadow', 'root:!$6$oldhash:19000:0:99999:7:::\nhello:!!:19000:0:99999:7:::\nstudent:!:19000:0:99999:7:::\n', 'root'), true);
    vfs.ensureDefaultLoginAccounts();
    assert.equal(await verifyAccountPassword(vfs, 'hello', '123456'), true);
    assert.equal(await verifyAccountPassword(vfs, 'root', '123456'), true);
    assert.equal(await verifyAccountPassword(vfs, 'student', '123456'), false);
    assert.match(vfs.readFile('/etc/shadow', 'root') || '', /student:!:19000/);
  });
  await report('host mount removal checks VFS permissions and honors recursive mode', async () => {
    const vfs = new VirtualFileSystem();
    const allowedPath = '/home/hello/host-remove-probe';
    const deniedPath = '/etc/passwd';
    assert.equal(vfs.writeFile(allowedPath, 'host mirror', 'hello'), true);
    const originalMatch = globalHostMountEngine.getMatchingMount;
    const originalRemove = globalHostMountEngine.removeEntry;
    const removed = [];
    try {
      globalHostMountEngine.getMatchingMount = (path) => path === allowedPath || path === deniedPath
        ? { mount: { targetPath: '/', handle: {}, mountedAt: new Date() }, relativePath: path.slice(1) }
        : null;
      globalHostMountEngine.removeEntry = async (path, recursive = false) => {
        removed.push({ path, recursive });
        return true;
      };
      assert.equal(vfs.remove(allowedPath, true, 'hello'), false);
      assert.deepEqual(removed, []);
      assert.equal(vfs.chmod('/etc', '555', false, 'root'), true);
      assert.equal(await vfs.removeAsync(deniedPath, false, 'hello'), false);
      assert.deepEqual(removed, []);
      assert.equal(await vfs.removeAsync(allowedPath, true, 'hello'), true);
      assert.deepEqual(removed, [{ path: allowedPath, recursive: true }]);
    } finally {
      globalHostMountEngine.getMatchingMount = originalMatch;
      globalHostMountEngine.removeEntry = originalRemove;
    }
  });
  await report('useradd stores an initial password hash instead of plaintext', async () => {
    const username = `verify_auth_${Date.now()}`;
    const originalPasswd = globalVFS.readFile('/etc/passwd', 'root') || '';
    const originalShadow = globalVFS.readFile('/etc/shadow', 'root') || '';
    const originalGroup = globalVFS.readFile('/etc/group', 'root') || '';
    try {
      const useradd = userCommands.find((command) => command.name === 'useradd');
      assert.ok(useradd);
      const result = await useradd.execute({
        vfs: globalVFS,
        env: { USER: 'root' },
        args: [username],
        lang: 'en',
        processManager: globalProcessManager,
        callerPid: 1,
      });
      assert.equal(result.exitCode, 0, result.stderr);
      const stored = globalVFS.readFile('/etc/shadow', 'root')?.split('\n')
        .find((line) => line.startsWith(`${username}:`))?.split(':')[1] || '';
      assert.match(stored, /^pbkdf2-sha256\$/);
      assert.notEqual(stored, username);
      assert.equal(await verifyAccountPassword(globalVFS, username, username), true);
    } finally {
      globalVFS.writeFile('/etc/passwd', originalPasswd, 'root');
      globalVFS.writeFile('/etc/shadow', originalShadow, 'root');
      globalVFS.writeFile('/etc/group', originalGroup, 'root');
      globalVFS.remove(`/home/${username}`, true, 'root');
    }
  });
  await report('VFS startup writes override stale IndexedDB snapshots and flush after hydration', async () => {
    const originalWindow = globalThis.window;
    const originalIndexedDB = globalThis.indexedDB;
    const path = '/home/hello/startup-race.txt';
    const deletedPath = '/home/hello/startup-delete.txt';
    const shadowPath = '/etc/shadow';
    const rows = new Map([[shadowPath, {
      path: shadowPath, name: 'shadow', type: 'file', permissions: 'rw-r-----', owner: 'root',
      group: 'root', size: 90, updatedAt: new Date(0).toISOString(), content: 'root::19000:0:99999:7:::\nhello::19000:0:99999:7:::\nstudent:$6$legacy$hash:19000:0:99999:7:::\n',
    }], [path, {
      path, name: 'startup-race.txt', type: 'file', permissions: 'rw-r--r--', owner: 'hello',
      group: 'hello', size: 5, updatedAt: new Date(0).toISOString(), content: 'stale',
    }], [deletedPath, {
      path: deletedPath, name: 'startup-delete.txt', type: 'file', permissions: 'rw-r--r--', owner: 'hello',
      group: 'hello', size: 5, updatedAt: new Date(0).toISOString(), content: 'stale',
    }], ['/root', {
      path: '/root', name: 'root', type: 'directory', permissions: 'rwxr-xr-x', owner: 'hello',
      group: 'hello', size: 4096, updatedAt: new Date(0).toISOString(),
    }]]);
    let failWriteTransactions = false;
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: (_name, mode) => {
        const tx = { objectStore: () => ({
          getAll: () => {
            const request = {};
            setTimeout(() => { request.result = [...rows.values()]; request.onsuccess?.(); }, 0);
            return request;
          },
          put: (record) => rows.set(record.path, { ...record }),
          delete: (recordPath) => rows.delete(recordPath),
        }) };
        if (mode === 'readwrite') setTimeout(() => {
          if (failWriteTransactions) tx.onabort?.();
          else tx.oncomplete?.();
        }, 0);
        return tx;
      },
    };
    const fakeIndexedDB = { open: () => {
      const request = { result: db };
      setTimeout(() => request.onsuccess?.({ target: request }), 0);
      return request;
    } };
    try {
      globalThis.window = { indexedDB: fakeIndexedDB };
      globalThis.indexedDB = fakeIndexedDB;
      const vfs = new VirtualFileSystem();
      let initializationReady = false;
      const readyPromise = vfs.waitUntilReady().then(() => { initializationReady = true; });
      assert.equal(vfs.writeFile(path, 'fresh', 'hello'), true);
      assert.equal(vfs.writeFile(deletedPath, 'temporary', 'hello'), true);
      assert.equal(vfs.remove(deletedPath, false, 'hello'), true);
      await Promise.resolve();
      assert.equal(initializationReady, false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await readyPromise;
      assert.equal(initializationReady, true);
      assert.equal(vfs.readFile(path, 'hello'), 'fresh');
      assert.equal(rows.get(path)?.content, 'fresh');
      assert.equal(vfs.exists(deletedPath), false);
      assert.equal(rows.has(deletedPath), false);
      assert.equal(await verifyAccountPassword(vfs, 'hello', '123456'), true);
      assert.equal(await verifyAccountPassword(vfs, 'root', '123456'), true);
      const recoveredShadow = vfs.readFile(shadowPath, 'root') || '';
      assert.match(recoveredShadow, /student:\$6\$legacy\$hash:/);
      assert.match(recoveredShadow, /hello:123456:/);
      assert.match(recoveredShadow, /root:123456:/);
      assert.match(rows.get(shadowPath)?.content || '', /hello:/);
      // Recover a profile whose persisted snapshot has no /etc/shadow at all.
      rows.delete(shadowPath);
      const missingShadowVfs = new VirtualFileSystem();
      await missingShadowVfs.waitUntilReady();
      assert.equal(await verifyAccountPassword(missingShadowVfs, 'hello', '123456'), true);
      assert.equal(await verifyAccountPassword(missingShadowVfs, 'root', '123456'), true);
      assert.equal(await missingShadowVfs.persistPaths([shadowPath]), true);
      assert.match(rows.get(shadowPath)?.content || '', /root:123456:/);
      assert.match(rows.get(shadowPath)?.content || '', /hello:123456:/);
      // Imported Linux images may carry crypt(3) hashes, which browser WebCrypto
      // cannot authenticate. Built-in classroom accounts must remain recoverable.
      rows.set(shadowPath, { ...rows.get(shadowPath), content: 'root:$6$legacy$root-hash:19000:0:99999:7:::\nhello:$y$j9T$legacy$hello-hash:19000:0:99999:7:::\n' });
      const cryptShadowVfs = new VirtualFileSystem();
      await cryptShadowVfs.waitUntilReady();
      assert.equal(await verifyAccountPassword(cryptShadowVfs, 'hello', '123456'), true);
      assert.equal(await verifyAccountPassword(cryptShadowVfs, 'root', '123456'), true);
      assert.match(rows.get(shadowPath)?.content || '', /hello:123456:/);
      assert.equal(cryptShadowVfs.getNodeByPath('/root', 'root')?.owner, 'root');
      assert.equal(cryptShadowVfs.getNodeByPath('/root', 'root')?.permissions, 'rwx------');
      assert.equal(rows.get('/root')?.owner, 'root');
      assert.equal(rows.get('/root')?.permissions, 'rwx------');
      assert.equal(await vfs.persistPaths([path]), true);
      failWriteTransactions = true;
      assert.equal(await vfs.persistPaths([path]), false);
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalIndexedDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = originalIndexedDB;
    }
  });
  await report('the raw global VFS is not exposed on the browser window', async () => {
    const source = await readFile(new URL('../src/core/vfs.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\(window\s+as\s+any\)\.globalVFS\s*=/);
  });
  await report('EAF isolation fails closed when Worker support is unavailable', async () => {
    if (typeof Worker !== 'undefined') return;
    await assert.rejects(
      runEafInWorker('', {}, {}, () => undefined),
      /requires Web Worker and Blob URL support/,
    );
  });
  await report('EAF Worker timeout terminates execution and signals resource cleanup', async () => {
    const originalWorker = globalThis.Worker;
    let terminated = false;
    let terminationReason;
    globalThis.Worker = class IdleWorker {
      postMessage() {}
      terminate() { terminated = true; }
    };
    try {
      await assert.rejects(
        runEafInWorker('', {}, {}, () => undefined, undefined, 5, (reason) => { terminationReason = reason; }),
        /exceeded 5ms/,
      );
      assert.equal(terminated, true);
      assert.match(terminationReason?.message || '', /exceeded 5ms/);
    } finally {
      if (originalWorker === undefined) delete globalThis.Worker;
      else globalThis.Worker = originalWorker;
    }
  });
  await report('EAF startup clone failures clean up the Worker and Blob URL immediately', async () => {
    const originalWorker = globalThis.Worker;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let worker;
    let revoked = 0;
    URL.createObjectURL = () => 'blob:earendel-verification';
    URL.revokeObjectURL = () => { revoked++; };
    globalThis.Worker = class FailingPostWorker {
      terminated = false;
      postMessage() { throw new Error('DataCloneError: unsupported context value'); }
      terminate() { this.terminated = true; }
      constructor() { worker = this; }
    };
    try {
      await assert.rejects(
        runEafInWorker('', {}, {}, () => undefined),
        /DataCloneError: unsupported context value/,
      );
      assert.equal(worker.terminated, true);
      assert.equal(revoked, 1);
    } finally {
      if (originalWorker === undefined) delete globalThis.Worker;
      else globalThis.Worker = originalWorker;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
  await report('EAF waits for in-flight RPC responses before terminating a completed Worker', async () => {
    const originalWorker = globalThis.Worker;
    let instance;
    class ControlledWorker {
      posted = [];
      terminated = false;
      postMessage(message) { this.posted.push(message); }
      terminate() { this.terminated = true; }
    }
    globalThis.Worker = class extends ControlledWorker {
      constructor(url) { super(url); instance = this; }
    };
    let completeRpc;
    try {
      const execution = runEafInWorker('', {}, {}, () => new Promise((resolve) => { completeRpc = resolve; }), undefined, 1000);
      const channelToken = instance.posted[0].channelToken;
      const rpcHandling = instance.onmessage({ data: { type: 'rpc', channelToken, id: 1, method: 'probe', args: [] } });
      assert.equal(typeof completeRpc, 'function');
      instance.onmessage({ data: { type: 'result', channelToken, value: 'completed' } });
      await Promise.resolve();
      assert.equal(instance.terminated, false, 'Worker must stay alive until its outstanding RPC is replied to');
      completeRpc({ ok: true });
      await rpcHandling;
      const result = await execution;
      assert.equal(result.value, 'completed');
      assert.equal(instance.terminated, true);
      assert.ok(instance.posted.some((message) => message.type === 'rpc-result' && message.id === 1));
    } finally {
      if (originalWorker === undefined) delete globalThis.Worker;
      else globalThis.Worker = originalWorker;
    }
  });
  await report('EAF Worker bootstrap parses and strips direct browser capabilities', async () => {
    assert.doesNotThrow(() => new Function(EAF_WORKER_SOURCE));
    for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'caches', 'importScripts', 'Worker', 'navigator', 'postMessage', 'onmessage', 'BroadcastChannel']) {
      assert.ok(EAF_WORKER_SOURCE.includes(`'${api}'`), `missing blocked API: ${api}`);
    }
    assert.match(EAF_WORKER_SOURCE, /if \(!event\.isTrusted\) return/);
    assert.match(EAF_WORKER_SOURCE, /channelToken/);
    assert.match(EAF_WORKER_SOURCE, /Worker platform could not disable APIs/);
  });
  await report('EAF code cannot access the Worker bootstrap authentication channel', async () => {
    const listeners = new Map();
    const outbound = [];
    const workerRealm = {
      postMessage: (message) => outbound.push(message),
      addEventListener: (type, listener) => listeners.set(type, listener),
    };
    runInNewContext(EAF_WORKER_SOURCE, workerRealm);
    const listener = listeners.get('message');
    assert.equal(typeof listener, 'function');
    await listener({
      isTrusted: true,
      data: {
        type: 'run', channelToken: 'verification-secret',
        code: `console.log([typeof channelToken,typeof sendToHost,typeof pending,typeof addWorkerListener].join(','));`,
        context: { env: {} }, process: {},
      },
    });
    const log = outbound.find((message) => message.type === 'console');
    assert.ok(log);
    assert.equal(Array.from(log.args).join(','), 'undefined,undefined,undefined,undefined');
    assert.equal(outbound.some((message) => message.type === 'result' && message.channelToken === 'verification-secret'), true);
  });
  await report('Content Security Policy limits EAF module imports to the app origin', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] || '';
    assert.match(policy, /script-src 'self' 'unsafe-eval'/);
    assert.match(policy, /worker-src 'self' blob:/);
    assert.doesNotMatch(policy, /script-src[^;]*https:/);
  });
  const { createCapabilityVfsView } = await server.ssrLoadModule('/src/core/scopedVfs.ts');
  const { parseSkillContent, MAX_SKILL_TURNS, MAX_SKILL_SOURCE_CHARS } = await server.ssrLoadModule('/src/core/skillParser.ts');
  const [{ HarnessEngine, isMcpToolApproved, intersectNetworkScopes }, { globalIPCBus, IPCBus }, { globalAgentMemoryManager }, { globalWaylandDaemon }, { ipcTraceCommand }, { dmesgCommand }] = await Promise.all([
    server.ssrLoadModule('/src/core/harnessEngine.ts'),
    server.ssrLoadModule('/src/kernel/ipcBus.ts'),
    server.ssrLoadModule('/src/core/memoryEngine.ts'),
    server.ssrLoadModule('/src/kernel/services/waylandd.ts'),
    server.ssrLoadModule('/src/core/commands/ipcTraceCommand.ts'),
    server.ssrLoadModule('/src/core/commands/dmesgCommand.ts'),
  ]);
  await report('Skill audit marks bounded-event truncation', () => {
    const engine = new HarnessEngine();
    const context = { auditEvents: [], auditDroppedEvents: 0 };
    for (let index = 0; index < 505; index++) engine.recordAudit(context, 'verification-event', String(index));
    assert.equal(context.auditEvents.length, 500);
    assert.equal(context.auditDroppedEvents, 6);
    assert.equal(context.auditEvents[0].detail, '0');
    assert.equal(context.auditEvents[499].action, 'audit-truncated');
    assert.match(context.auditEvents[499].detail, /6 event\(s\) omitted/);
  });
  await report('MCP authorization is scoped to an exact server and tool pair', () => {
    const grants = ['school-fetch/read_page', 'course-planner/create_event'];
    assert.equal(isMcpToolApproved(grants, 'school-fetch', 'read_page'), true);
    assert.equal(isMcpToolApproved(grants, 'school-fetch', 'delete_page'), false);
    assert.equal(isMcpToolApproved(grants, 'school-fetch', 'read_page/with_extra'), false);
    assert.equal(isMcpToolApproved(grants, 'school-fetch/read_page', 'delete_page'), false);
  });
  await report('IPC traces redact payload values and require CAP_SYS_ADMIN to inspect', async () => {
    const bus = new IPCBus();
    const secret = 'private inference prompt and API token';
    let deliveredPayload;
    bus.registerProcess(777_001);
    bus.registerService('verification', 777_002, async (message) => {
      deliveredPayload = message.payload;
      return { ok: true };
    });
    await bus.sendIPC(bus.getProcessEndpoint(777_001), 'verification', 'INFER', { prompt: secret, token: 'secret-token' });
    assert.equal(deliveredPayload.prompt, secret, 'trace redaction must not alter service input');
    const trace = bus.getIPCLogs()[0];
    assert.doesNotMatch(JSON.stringify(trace.payload), /private inference prompt|secret-token/);
    assert.equal(trace.payload, '[redacted object payload]');

    const hugePayload = new Proxy({}, { ownKeys: () => { throw new Error('payload must not be enumerated for tracing'); } });
    await bus.sendIPC(bus.getProcessEndpoint(777_001), 'verification', 'OPAQUE', hugePayload);
    assert.equal(bus.getIPCLogs()[1].payload, '[redacted object payload]');

    const deniedTrace = ipcTraceCommand.execute({ callerPid, args: [] });
    const deniedDmesg = dmesgCommand.execute({ callerPid, args: ['--ipc'] });
    assert.equal(deniedTrace.exitCode, 1);
    assert.equal(deniedDmesg.exitCode, 1);
    assert.equal(ipcTraceCommand.execute({ callerPid: 1, args: [] }).exitCode, 0);
    assert.equal(dmesgCommand.execute({ callerPid: 1, args: ['--ipc'] }).exitCode, 0);
    const traceService = `verify-trace-${Date.now()}`;
    globalIPCBus.registerService(traceService, 1, async () => ({ ok: true }));
    try {
      assert.equal(ipcTraceCommand.execute({ callerPid: 1, args: ['off'] }).exitCode, 0);
      const countBeforeDisabledCall = globalIPCBus.getIPCLogs().length;
      await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(callerPid), traceService, 'TRACE_PROBE', { secret });
      assert.equal(globalIPCBus.getIPCLogs().length, countBeforeDisabledCall);
      assert.equal(ipcTraceCommand.execute({ callerPid: 1, args: ['on'] }).exitCode, 0);
      await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(callerPid), traceService, 'TRACE_PROBE', { secret });
      assert.equal(globalIPCBus.getIPCLogs().length, countBeforeDisabledCall + 1);
    } finally {
      globalIPCBus.setTracingEnabled(true);
      globalIPCBus.unregisterService(traceService);
    }
  });
  await report('Skill audit records persist through a root-only trusted writer', async () => {
    const sessionId = `verify_audit_${Date.now()}`;
    const persisted = await globalAgentMemoryManager.appendSessionAudit(createCapabilityVfsView(globalVFS, callerPid, 'hello'), {
      timestamp: new Date().toISOString(), sessionId, pid: callerPid, skillName: 'verify',
      status: 'SUCCESS', turns: 1, events: [{ at: new Date().toISOString(), action: 'verify', detail: 'audit write' }],
    });
    assert.equal(persisted, true);
    const path = `/var/log/harness/${sessionId}.jsonl`;
    const content = globalVFS.readFile(path, 'root');
    assert.match(content || '', /"skillName":"verify"/);
    assert.equal(globalVFS.readFile(path, 'hello'), null);
    const node = globalVFS.getNodeByPath(path);
    assert.equal(node?.owner, 'root');
    assert.equal(node?.permissions, 'rw-------');
    assert.equal(globalVFS.remove(path, false, 'root'), true);
    const oversizedSession = `verify_audit_oversized_${Date.now()}`;
    const rejected = await globalAgentMemoryManager.appendSessionAudit(createCapabilityVfsView(globalVFS, callerPid, 'hello'), {
      timestamp: new Date().toISOString(), sessionId: oversizedSession, pid: callerPid, skillName: 'verify',
      status: 'ERROR', turns: 1, error: 'x'.repeat(600_000),
    });
    assert.equal(rejected, false, 'oversized audit records must fail closed');
    assert.equal(globalVFS.exists(`/var/log/harness/${oversizedSession}.jsonl`), false);
  });
  await report('Scratchpad persistence reports denied writes instead of returning a false path', () => {
    const allowedView = createCapabilityVfsView(globalVFS, callerPid, 'hello');
    const content = 'scratchpad-persistence-check';
    const savedPath = globalAgentMemoryManager.writeScratchpad(allowedView, callerPid, 'verify.txt', content);
    assert.equal(savedPath, `/tmp/agent/${callerPid}/verify.txt`);
    assert.equal(allowedView.readFile(savedPath), content);
    globalAgentMemoryManager.cleanupScratchpad(allowedView, callerPid);

    const deniedPid = 989_991;
    const deniedView = createCapabilityVfsView(globalVFS, deniedPid, 'hello');
    assert.equal(globalAgentMemoryManager.writeScratchpad(deniedView, deniedPid, 'denied.txt', content), null);
  });
  const { globalKernelAgentManager } = await server.ssrLoadModule('/src/kernel/agentFramework.ts');
  const syscallCtx = (pid) => (sysNo, ...args) => syscallAs(pid, sysNo, ...args);
  await report('unprivileged users can read shipped Skills without write access', () => {
    const userVfs = createCapabilityVfsView(globalVFS, callerPid, 'hello');
    const skillSource = userVfs.readFile('/skills/sys-doctor/skill.md');
    assert.match(skillSource || '', /name: sys-doctor/);
    assert.equal(userVfs.writeFile('/skills/sys-doctor/skill.md', 'tampered', 'root'), false);
  });
  await report('LLM API credentials are unreadable to unprivileged VFS views and syscalls', async () => {
    const userVfs = createCapabilityVfsView(globalVFS, callerPid, 'hello');
    const rootConfig = globalVFS.readFile('/etc/llm.conf', 'root');
    assert.match(rootConfig || '', /API_KEY=/);
    assert.equal(userVfs.readFile('/etc/llm.conf'), null);
    const node = globalVFS.getNodeByPath('/etc/llm.conf');
    assert.equal(node?.owner, 'root');
    assert.equal(node?.permissions, 'rw-------');
    const syscallRead = await syscallAs(callerPid, SyscallNo.SYS_READ, '/etc/llm.conf');
    assert.notEqual(syscallRead.code, 0);
  });
  await report('slow Agent observations never block an authorized syscall', async () => {
    let finishObservation;
    let getPidObservationStarted = false;
    const agentId = `nonblocking-syscall-${Date.now()}`;
    globalKernelAgentManager.registerAgent({
      id: agentId,
      name: 'verification delayed observer',
      description: 'holds one observation open to prove syscalls do not await agents',
      isDaemon: false,
      enabled: true,
      observe: (observation) => observation.event === 'getpid'
        ? (getPidObservationStarted = true, new Promise((resolve) => { finishObservation = resolve; }))
        : Promise.resolve(false),
      infer: async () => ({ actionType: 'LOG', reason: 'verification' }),
      act: async () => true,
    });
    try {
      const result = await syscallAs(callerPid, SyscallNo.SYS_GETPID);
      assert.equal(result.code, 0);
      assert.equal(result.data, callerPid);
      assert.equal(getPidObservationStarted, false, 'Agent code ran on the syscall stack');
      for (let attempt = 0; attempt < 100 && !getPidObservationStarted; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.equal(getPidObservationStarted, true, 'queued observation was not dispatched asynchronously');
    } finally {
      finishObservation?.(false);
      globalKernelAgentManager.setAgentStatus(agentId, false);
    }
  });
  await report('Agent action history records rejected act results', async () => {
    const { KernelAgentManager } = await server.ssrLoadModule('/src/kernel/agentFramework.ts');
    const manager = new KernelAgentManager();
    const agentId = `rejected-agent-action-${Date.now()}`;
    manager.registerAgent({
      id: agentId, name: 'rejecting agent', description: 'returns false from act', isDaemon: false, enabled: true,
      observe: async () => true,
      infer: async () => ({ actionType: 'LOG', reason: 'expected rejection' }),
      act: async () => false,
    });
    try {
      const actions = await manager.dispatchObservation('process', 'audit-probe', 'safe payload');
      assert.equal(actions.length, 1);
      const entry = manager.getActionHistory().find((item) => item.agentId === agentId);
      assert.equal(entry?.acted, false);
      assert.equal(entry?.action.reason, 'expected rejection');
    } finally {
      manager.setAgentStatus(agentId, false);
    }
  });
  await report('Agent enqueue never reads arbitrary payload getters or Proxy traps synchronously', async () => {
    const { KernelAgentManager } = await server.ssrLoadModule('/src/kernel/agentFramework.ts');
    const manager = new KernelAgentManager();
    const agentId = `opaque-observation-${Date.now()}`;
    let trapCalls = 0;
    let deliveredPayload;
    const hostilePayload = new Proxy({}, {
      ownKeys: () => { trapCalls++; throw new Error('ownKeys must not run on enqueue'); },
      get: () => { trapCalls++; throw new Error('getter must not run on enqueue'); },
      getOwnPropertyDescriptor: () => { trapCalls++; throw new Error('descriptor trap must not run on enqueue'); },
    });
    manager.registerAgent({
      id: agentId, name: 'opaque payload observer', description: 'observes only a safe placeholder', isDaemon: false, enabled: true,
      observe: async () => true,
      infer: async (observation) => {
        deliveredPayload = observation.payload;
        return { actionType: 'LOG', reason: 'opaque payload recorded' };
      },
      act: async () => true,
    });
    manager.enqueueObservation('syscall', 'opaque-payload-probe', hostilePayload);
    assert.equal(trapCalls, 0);
    for (let attempt = 0; attempt < 20 && deliveredPayload === undefined; attempt++) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deliveredPayload, '[object payload omitted]');
    assert.equal(trapCalls, 0);
    manager.setAgentStatus(agentId, false);
  });
  await report('a stalled Agent observation does not stall later queued observations', async () => {
    const { KernelAgentManager } = await server.ssrLoadModule('/src/kernel/agentFramework.ts');
    const manager = new KernelAgentManager();
    manager.maxAgentResponseMs = 250;
    const slowId = `stalled-queue-agent-${Date.now()}`;
    const fastId = `responsive-queue-agent-${Date.now()}`;
    let fastObservedSecond = false;
    const observedEvents = [];
    manager.registerAgent({
      id: slowId, name: 'stalled observer', description: 'holds one inference open', isDaemon: false, enabled: true,
      observe: async (observation) => observation.event.startsWith('queue-probe-'),
      infer: () => new Promise(() => {}),
      act: async () => true,
    });
    manager.registerAgent({
      id: fastId, name: 'responsive observer', description: 'observes later queue entries', isDaemon: false, enabled: true,
      observe: async (observation) => { observedEvents.push(observation.event); return observation.event === 'queue-probe-second'; },
      infer: async (observation) => ({ actionType: 'LOG', reason: observation.event }),
      act: async (action) => { fastObservedSecond = action.reason === 'queue-probe-second'; return true; },
    });
    manager.enqueueObservation('syscall', 'queue-probe-first', {});
    manager.enqueueObservation('syscall', 'queue-probe-second', {});
    try {
      for (let attempt = 0; attempt < 30 && !fastObservedSecond; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.equal(fastObservedSecond, true, `healthy Agent should process the second event while the first inference is pending; saw ${observedEvents.join(',')}`);
    } finally {
      manager.setAgentStatus(slowId, false);
      manager.setAgentStatus(fastId, false);
    }
  });
  await report('AI inference is bounded per process and never blocks unrelated syscalls', async () => {
    const endpoint = 'https://llm.verify.invalid/v1/chat/completions';
    const originalConfig = globalVFS.readFile('/etc/llm.conf', 'root');
    const originalFetch = globalThis.fetch;
    const pendingResponses = [];
    let inferenceCalls = [];
    globalCapabilityManager.grantCapability(callerPid, 'CAP_NET_ADMIN', endpoint);
    assert.equal(globalVFS.writeFile('/etc/llm.conf', [
      'PROVIDER=openai', `BASE_URL=${endpoint.slice(0, -'/chat/completions'.length)}`,
      'MODEL_NAME=verify-model', 'API_KEY=verify-key', 'ENABLE_LOCAL_MOCK=false',
    ].join('\n') + '\n', 'root'), true);
    globalThis.fetch = async () => new Promise((resolve) => pendingResponses.push(resolve));
    inferenceCalls = [
      syscallAs(callerPid, SyscallNo.SYS_INFER, 'first pending request'),
      syscallAs(callerPid, SyscallNo.SYS_INFER, 'second pending request'),
    ];
    try {
      for (let attempt = 0; attempt < 20 && pendingResponses.length < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.equal(pendingResponses.length, 2, 'both authorized remote inference requests should be in flight');
      const unrelated = await syscallAs(callerPid, SyscallNo.SYS_GETPID);
      assert.equal(unrelated.code, 0);
      assert.equal(unrelated.data, callerPid);
      const overflow = await syscallAs(callerPid, SyscallNo.SYS_INFER, 'third concurrent request');
      assert.equal(overflow.code, -1);
      assert.match(overflow.error, /EAGAIN: inference capacity is full/);
      for (const resolve of pendingResponses) {
        resolve({ ok: true, json: async () => ({ choices: [{ message: { content: 'verified' } }] }) });
      }
      const completed = await Promise.all(inferenceCalls);
      assert.ok(completed.every((result) => result.code === 0 && /verified/.test(result.data)));

      const oversized = await syscallAs(callerPid, SyscallNo.SYS_INFER, 'x'.repeat(32_769));
      assert.equal(oversized.code, -1);
      assert.match(oversized.error, /E2BIG: inference prompt exceeds/);

      globalThis.fetch = async () => ({
        ok: true,
        headers: { get: () => '262145' },
        json: async () => { throw new Error('oversized body should be rejected before parsing'); },
      });
      const oversizedBody = await syscallAs(callerPid, SyscallNo.SYS_INFER, 'response size probe');
      assert.equal(oversizedBody.code, -1);
      assert.match(oversizedBody.error, /LLM response exceeds 262144 bytes/);

      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'x'.repeat(32_769) } }] }),
      });
      const oversizedText = await syscallAs(callerPid, SyscallNo.SYS_INFER, 'response text probe');
      assert.equal(oversizedText.code, -1);
      assert.match(oversizedText.error, /LLM response text exceeds 32768 characters/);

      globalThis.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: { message: 'verification rate limit' } }),
      });
      const rejectedByProvider = await syscallAs(callerPid, SyscallNo.SYS_INFER, 'provider failure probe');
      assert.equal(rejectedByProvider.code, -1);
      assert.match(rejectedByProvider.error, /LLM API HTTP 429: verification rate limit/);
    } finally {
      for (const resolve of pendingResponses) {
        resolve({ ok: true, json: async () => ({ choices: [{ message: { content: 'cleanup' } }] }) });
      }
      await Promise.allSettled(inferenceCalls);
      globalThis.fetch = originalFetch;
      globalCapabilityManager.revokeCapability(callerPid, 'CAP_NET_ADMIN', endpoint);
      if (originalConfig !== null) globalVFS.writeFile('/etc/llm.conf', originalConfig, 'root');
    }
  });
  await report('stopping an Agent invalidates an in-flight inference before act', async () => {
    let finishInference;
    let inferenceStarted = false;
    let actCalled = false;
    let inferenceSignal;
    const agentId = `stopped-inference-${Date.now()}`;
    globalKernelAgentManager.registerAgent({
      id: agentId,
      name: 'verification cancellable observer',
      description: 'must not act after being stopped while inference is pending',
      isDaemon: false,
      enabled: true,
      observe: async () => true,
      infer: (_observation, signal) => {
        inferenceStarted = true;
        inferenceSignal = signal;
        return new Promise((resolve) => { finishInference = resolve; });
      },
      act: async () => { actCalled = true; return true; },
    });
    try {
      const dispatch = globalKernelAgentManager.dispatchObservation('network', 'stop-race-probe', {});
      for (let attempt = 0; attempt < 20 && !inferenceStarted; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.equal(inferenceStarted, true, 'Agent inference did not start');
      assert.equal(globalKernelAgentManager.setAgentStatus(agentId, false), true);
      assert.equal(inferenceSignal?.aborted, true, 'stopping the Agent should abort its active inference');
      finishInference?.({ actionType: 'CUSTOM', reason: 'late action must be ignored' });
      const actions = await dispatch;
      assert.equal(actCalled, false);
      assert.equal(actions.some((action) => action.reason === 'late action must be ignored'), false);

      const { KernelAgentManager } = await server.ssrLoadModule('/src/kernel/agentFramework.ts');
      const isolatedManager = new KernelAgentManager();
      isolatedManager.maxAgentResponseMs = 20;
      const isolatedId = `reenabled-agent-${Date.now()}`;
      isolatedManager.registerAgent({
        id: isolatedId, name: 're-enabled observer', description: 'stale timeout must not disable a newer run', isDaemon: false, enabled: true,
        observe: () => new Promise(() => {}),
        infer: async () => ({ actionType: 'LOG', reason: 'unused' }),
        act: async () => true,
      });
      const oldRun = isolatedManager.dispatchObservation('network', 'reenable-race-probe', {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      isolatedManager.setAgentStatus(isolatedId, false);
      isolatedManager.setAgentStatus(isolatedId, true);
      await oldRun;
      assert.equal(isolatedManager.getAgent(isolatedId)?.enabled, true, 'stale timeout disabled an explicitly re-enabled Agent');
    } finally {
      globalKernelAgentManager.setAgentStatus(agentId, false);
    }
  });
  await report('timed-out Agent work retains its slot until the underlying promise settles', async () => {
    const { KernelAgentManager } = await server.ssrLoadModule('/src/kernel/agentFramework.ts');
    const manager = new KernelAgentManager();
    manager.maxAgentResponseMs = 10;
    const agentId = `bounded-agent-run-${Date.now()}`;
    let completeFirstInference;
    let observeCalls = 0;
    let inferCalls = 0;
    let firstInferSignal;
    manager.registerAgent({
      id: agentId, name: 'bounded unresolved observer', description: 'must not accumulate timed-out tasks',
      isDaemon: false, enabled: true,
      observe: async () => { observeCalls++; return true; },
      infer: (_observation, signal) => {
        inferCalls++;
        if (inferCalls === 1) {
          firstInferSignal = signal;
          return new Promise((resolve) => { completeFirstInference = resolve; });
        }
        return Promise.resolve({ actionType: 'LOG', reason: 'second generation completed' });
      },
      act: async () => true,
    });
    const firstRun = manager.dispatchObservation('syscall', 'unresolved-agent-probe', {});
    for (let attempt = 0; attempt < 20 && inferCalls === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 0));
    await firstRun;
    assert.equal(manager.getAgent(agentId)?.enabled, false, 'the unresolved inference should be timed out and disabled');
    assert.equal(firstInferSignal?.aborted, true, 'timeout should cooperatively cancel the active Agent inference');
    manager.setAgentStatus(agentId, true);
    assert.deepEqual(await manager.dispatchObservation('syscall', 'restart-while-stuck', {}), []);
    assert.equal(inferCalls, 1, 'restarting a timed-out Agent must not launch overlapping work');

    completeFirstInference?.({ actionType: 'LOG', reason: 'late inference is ignored' });
    for (let attempt = 0; attempt < 20 && manager.getObservationQueueStats().draining; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const secondRun = await manager.dispatchObservation('syscall', 'restart-after-settle', {});
    assert.equal(observeCalls, 2);
    assert.equal(secondRun[0]?.reason, 'second generation completed');
  });
  await report('agent-test is serialized, cancellable, and bounded by the Agent deadline', async () => {
    const { agentTestCommand } = await server.ssrLoadModule('/src/core/commands/agentCommands.ts');
    const originalDeadline = globalKernelAgentManager.maxAgentResponseMs;
    const agentId = `agent-test-timeout-${Date.now()}`;
    let completeInference;
    let inferenceSignal;
    let inferenceCalls = 0;
    globalKernelAgentManager.maxAgentResponseMs = 15;
    globalKernelAgentManager.registerAgent({
      id: agentId, name: 'manual test timeout', description: 'agent-test must not hang the terminal',
      isDaemon: false, enabled: true,
      observe: async (observation) => observation.event === 'TEST_EVENT',
      infer: (_observation, signal) => {
        inferenceCalls++;
        inferenceSignal = signal;
        return new Promise((resolve) => { completeInference = resolve; });
      },
      act: async () => true,
    });
    try {
      const result = await agentTestCommand.execute({ args: [agentId, 'timeout-probe'] });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /exceeded the 15ms test deadline/);
      assert.equal(inferenceSignal?.aborted, true);
      assert.equal(inferenceCalls, 1);
      globalKernelAgentManager.setAgentStatus(agentId, false);
      const overlapping = await agentTestCommand.execute({ args: [agentId, 'overlap-probe'] });
      assert.equal(overlapping.exitCode, 1);
      assert.match(overlapping.stderr, /already has an active run/);
      assert.equal(inferenceCalls, 1);
      completeInference?.({ actionType: 'LOG', reason: 'late manual inference' });
      for (let attempt = 0; attempt < 20 && globalKernelAgentManager.getObservationQueueStats().draining; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      completeInference?.({ actionType: 'LOG', reason: 'cleanup' });
      globalKernelAgentManager.setAgentStatus(agentId, false);
      globalKernelAgentManager.maxAgentResponseMs = originalDeadline;
    }
  });
  await report('Wayland surfaces are isolated by process ownership', async () => {
    void globalWaylandDaemon;
    const ownerEndpoint = globalIPCBus.getProcessEndpoint(callerPid);
    const surfaceResult = await globalIPCBus.sendIPC(ownerEndpoint, 'waylandd', 'SYS_WAYLAND_CREATE_SURFACE', {
      title: 'capability-bound surface', width: 99999, height: 500,
    });
    assert.equal(surfaceResult.success, true);
    const surfaceId = surfaceResult.surface.id;
    assert.equal(surfaceResult.surface.ownerPid, callerPid);
    assert.equal(surfaceResult.surface.width, 4096);
    const deniedProcess = globalProcessManager.addJob('wayland-no-device-capability', callerPid);
    globalCapabilityManager.clearCapabilities(deniedProcess.pid);
    try {
      const denied = await globalIPCBus.sendIPC(
        globalIPCBus.getProcessEndpoint(deniedProcess.pid), 'waylandd', 'SYS_WAYLAND_CREATE_SURFACE', {},
      );
      assert.equal(denied.success, false);
      assert.match(denied.error, /CAP_DEVICE_IO.*\/dev\/wayland/);
    } finally {
      globalProcessManager.killJob(deniedProcess.jobId);
    }
    const other = globalProcessManager.addJob('wayland-isolation-check', callerPid);
    try {
      assert.equal(globalCapabilityManager.hasCapability(other.pid, 'CAP_DEVICE_IO', '/dev/wayland'), true);
      assert.equal(globalCapabilityManager.hasCapability(other.pid, 'CAP_DEVICE_IO', '/dev/gps0'), false);
      const otherEndpoint = globalIPCBus.getProcessEndpoint(other.pid);
      const duplicateId = await globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_CREATE_SURFACE', {
        id: surfaceId, title: 'attempted surface takeover',
      });
      assert.notEqual(duplicateId.surface.id, surfaceId);
      const visible = await globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_LIST_SURFACES', {});
      assert.equal(visible.surfaces.some((surface) => surface.id === surfaceId), false);
      const destroyed = await globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_DESTROY_SURFACE', { id: surfaceId });
      assert.equal(destroyed.success, false);
      const destroyedAll = await globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_DESTROY_SURFACE', { id: 'all' });
      assert.equal(destroyedAll.success, false);
      const flushed = await globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_FLUSH_FRAMEBUFFER', { id: surfaceId });
      assert.equal(flushed.success, false);
      const orphan = globalProcessManager.addJob('wayland-orphan-check', callerPid);
      const orphanEndpoint = globalIPCBus.getProcessEndpoint(orphan.pid);
      const orphanSurface = await globalIPCBus.sendIPC(orphanEndpoint, 'waylandd', 'SYS_WAYLAND_CREATE_SURFACE', {});
      globalProcessManager.killJob(orphan.jobId);
      assert.equal(globalWaylandDaemon.surfaces.has(orphanSurface.surface.id), false, 'surface must be removed synchronously on process exit');
      const afterExit = await globalIPCBus.sendIPC(ownerEndpoint, 'waylandd', 'SYS_WAYLAND_LIST_SURFACES', {});
      assert.equal(afterExit.surfaces.some((surface) => surface.id === orphanSurface.surface.id), false);
    } finally {
      await globalIPCBus.sendIPC(ownerEndpoint, 'waylandd', 'SYS_WAYLAND_DESTROY_SURFACE', { id: surfaceId });
      try {
        const otherEndpoint = globalIPCBus.getProcessEndpoint(other.pid);
        const otherSurfaces = await globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_LIST_SURFACES', {});
        await Promise.all(otherSurfaces.surfaces.map((surface) =>
          globalIPCBus.sendIPC(otherEndpoint, 'waylandd', 'SYS_WAYLAND_DESTROY_SURFACE', { id: surface.id }),
        ));
      } catch { /* The owner may already have exited. */ }
      globalProcessManager.killJob(other.jobId);
    }
  });
  await report('Skills cannot launch unisolated JavaScript runtimes', async () => {
    const skillContent = [
      '---',
      'name: isolated-runtime-probe',
      'tools: {"system":["node"]}',
      'max_turns: 1',
      '---',
      'Run the requested Node.js script.',
    ].join('\n');
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        return { response: '\`\`\`bash\nnode probe.js\n\`\`\`', success: true, transport: 'verification' };
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const result = await new HarnessEngine().executeSkill(skillContent, {
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [], processManager: globalProcessManager, callerPid,
        syscall: syscallCtx(callerPid),
      }, undefined, undefined, { system_tools: ['node'] });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /denied in Skills until its runtime is isolated/);
      const auditDir = globalVFS.getNodeByPath('/var/log/harness', 'root');
      const record = [...(auditDir?.children?.values() || [])]
        .filter((node) => node.type === 'file')
        .flatMap((node) => (node.content || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
        .filter((entry) => entry.skillName === 'isolated-runtime-probe')
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      assert.ok(record);
      assert.equal(record.status, 'ERROR');
      assert.deepEqual(
        record.capabilities.filter((capability) => capability.type === 'CAP_DEVICE_IO').map((capability) => capability.scope),
        ['/dev/ai'],
      );
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
    }
  });
  await report('shell command execution uses the constrained VFS view', async () => {
    const shell = new ShellEngine(globalVFS, globalProcessManager);
    const echo = await shell.execute('echo constrained-vfs');
    assert.equal(echo.stdout.trim(), 'constrained-vfs');
  });
  await report('touch preserves write-only files and reports denied updates', async () => {
    const { fileCommands } = await server.ssrLoadModule('/src/core/commands/fileCommands.ts');
    const touch = fileCommands.find((command) => command.name === 'touch');
    assert.ok(touch);
    const pid = 8_000_222;
    const path = `/home/hello/.touch-write-only-${Date.now()}`;
    const deniedPath = `${path}-denied`;
    const noCreatePath = `${path}-missing`;
    assert.equal(globalVFS.writeFile(path, 'preserve this content', 'hello'), true);
    assert.equal(globalVFS.writeFile(deniedPath, 'also preserve this content', 'hello'), true);
    globalVFS.getNodeByPath(path).updatedAt = new Date(1);
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'touch-write-only-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', path);
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', noCreatePath);
    const scopedVfs = createCapabilityVfsView(globalVFS, pid, 'hello');
    try {
      assert.equal(scopedVfs.readFile(path), null);
      const updated = await touch.execute({ vfs: scopedVfs, env: { USER: 'hello' }, args: [path] });
      assert.equal(updated.exitCode, 0);
      assert.equal(globalVFS.readFile(path, 'root'), 'preserve this content');
      assert.ok(globalVFS.getNodeByPath(path).updatedAt.getTime() > 1);

      const noCreate = await touch.execute({ vfs: scopedVfs, env: { USER: 'hello' }, args: ['-c', noCreatePath] });
      assert.equal(noCreate.exitCode, 0);
      assert.equal(globalVFS.exists(noCreatePath, 'root'), false);

      const denied = await touch.execute({ vfs: scopedVfs, env: { USER: 'hello' }, args: [deniedPath] });
      assert.equal(denied.exitCode, 1);
      assert.match(denied.stderr, /cannot touch/);
      assert.equal(globalVFS.readFile(deniedPath, 'root'), 'also preserve this content');
    } finally {
      globalTaskScheduler.terminateProcess(pid);
      globalVFS.remove(path, false, 'root');
      globalVFS.remove(deniedPath, false, 'root');
    }
  });
  await report('cp/mv propagate write failures and prevent destructive self-moves', async () => {
    const { fileCommands } = await server.ssrLoadModule('/src/core/commands/fileCommands.ts');
    const cp = fileCommands.find((command) => command.name === 'cp');
    const mv = fileCommands.find((command) => command.name === 'mv');
    assert.ok(cp);
    assert.ok(mv);
    const pid = 8_000_223;
    const base = `/home/hello/.move-safety-${Date.now()}`;
    const source = `${base}-source`;
    const deniedTarget = `${base}-readonly`;
    const movedTarget = `${base}-moved`;
    const directory = `${base}-directory`;
    assert.equal(globalVFS.writeFile(source, 'source data', 'hello'), true);
    assert.equal(globalVFS.writeFile(deniedTarget, 'existing target', 'root'), true);
    assert.equal(globalVFS.chmod(deniedTarget, '444', false, 'root'), true);
    assert.equal(globalVFS.mkdir(directory, true), true);
    assert.equal(globalVFS.writeFile(`${directory}/child`, 'child data', 'hello'), true);
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'move-safety-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_READ', '/home/hello');
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', '/home/hello');
    const scopedVfs = createCapabilityVfsView(globalVFS, pid, 'hello');
    const context = (args) => ({ vfs: scopedVfs, env: { USER: 'hello' }, args });
    try {
      const failedMove = await mv.execute(context([source, deniedTarget]));
      assert.equal(failedMove.exitCode, 1);
      assert.match(failedMove.stderr, /copy failed/);
      assert.equal(globalVFS.readFile(source, 'root'), 'source data');
      assert.equal(globalVFS.readFile(deniedTarget, 'root'), 'existing target');

      const samePathMove = await mv.execute(context([source, source]));
      assert.equal(samePathMove.exitCode, 0);
      assert.equal(globalVFS.readFile(source, 'root'), 'source data');

      const selfMove = await mv.execute(context(['-r', directory, `${directory}/nested`]));
      assert.equal(selfMove.exitCode, 1);
      assert.match(selfMove.stderr, /subdirectory of itself/);
      assert.equal(globalVFS.readFile(`${directory}/child`, 'root'), 'child data');

      const selfCopy = await cp.execute(context(['-r', directory, `${directory}/nested-copy`]));
      assert.equal(selfCopy.exitCode, 1);
      assert.equal(globalVFS.exists(`${directory}/nested-copy`, 'root'), false);

      const successfulMove = await mv.execute(context([source, movedTarget]));
      assert.equal(successfulMove.exitCode, 0);
      assert.equal(globalVFS.exists(source, 'root'), false);
      assert.equal(globalVFS.readFile(movedTarget, 'root'), 'source data');
    } finally {
      globalTaskScheduler.terminateProcess(pid);
      for (const path of [source, deniedTarget, movedTarget, directory]) globalVFS.remove(path, true, 'root');
    }
  });
  await report('ln never overwrites files accidentally and reports unsupported hard links', async () => {
    const { fileCommands } = await server.ssrLoadModule('/src/core/commands/fileCommands.ts');
    const ln = fileCommands.find((command) => command.name === 'ln');
    assert.ok(ln);
    const base = `/home/hello/tests/.ln-safety-${Date.now()}`;
    const source = `${base}-source`;
    const destination = `${base}-destination`;
    assert.equal(globalVFS.writeFile(source, 'keep this data', 'hello'), true);
    assert.equal(globalVFS.writeFile(destination, 'do not clobber', 'hello'), true);
    try {
      const context = (args) => ({ vfs: globalVFS, env: { USER: 'hello' }, args });
      const rejected = await ln.execute(context(['-s', source, destination]));
      assert.equal(rejected.exitCode, 1);
      assert.equal(globalVFS.readFile(destination, 'root'), 'do not clobber');

      const hardLink = await ln.execute(context([source, destination]));
      assert.equal(hardLink.exitCode, 1);
      assert.match(hardLink.stderr, /hard links are not supported/);
      assert.equal(globalVFS.readFile(destination, 'root'), 'do not clobber');

      const forced = await ln.execute(context(['-sf', source, destination]));
      assert.equal(forced.exitCode, 0, forced.stderr);
      const link = globalVFS.getNodeByPath(destination, 'root');
      assert.equal(link?.type, 'symlink');
      assert.equal(link?.symlinkTarget, source);
    } finally {
      globalVFS.remove(source, false, 'root');
      globalVFS.remove(destination, false, 'root');
    }
  });
  await report('VFS follows relative symlinks with loop bounds and target-scoped capabilities', async () => {
    const pid = 8_000_032;
    const base = `/home/hello/tests/.symlink-resolution-${Date.now()}`;
    const target = `${base}-target`;
    const relativeLink = `${base}-relative`;
    const targetDirectory = `${base}-directory`;
    const directoryLink = `${base}-directory-link`;
    const throughLinkFile = `${targetDirectory}/created-through-link`;
    const firstLoop = `${base}-loop-a`;
    const secondLoop = `${base}-loop-b`;
    const outside = `/tmp/.symlink-cap-target-${Date.now()}`;
    const capLink = `${base}-cap-link`;
    assert.equal(globalVFS.writeFile(target, 'link target data', 'hello'), true);
    assert.equal(globalVFS.mkdir(targetDirectory, true), true);
    assert.equal(globalVFS.writeFile(outside, 'outside data', 'root'), true);
    assert.equal(globalVFS.symlink(target.slice(target.lastIndexOf('/') + 1), relativeLink), true);
    assert.equal(globalVFS.symlink(targetDirectory.slice(targetDirectory.lastIndexOf('/') + 1), directoryLink), true);
    assert.equal(globalVFS.symlink(secondLoop.slice(secondLoop.lastIndexOf('/') + 1), firstLoop), true);
    assert.equal(globalVFS.symlink(firstLoop.slice(firstLoop.lastIndexOf('/') + 1), secondLoop), true);
    assert.equal(globalVFS.symlink(outside, capLink), true);
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'symlink-capability-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_READ', capLink);
    try {
      assert.equal(globalVFS.isExecutable('/bin/sh'), true);
      assert.match(globalVFS.readFile('/usr/bin/bash', 'hello') || '', /GNU bash/);
      assert.equal(globalVFS.getNodeByPath(relativeLink, 'hello')?.type, 'symlink');
      assert.equal(globalVFS.getResolvedNodeByPath(relativeLink, 'hello')?.type, 'file');
      assert.equal(globalVFS.readFile(relativeLink, 'hello'), 'link target data');
      const syscallRead = await syscallAs(callerPid, SyscallNo.SYS_READ, relativeLink);
      assert.equal(syscallRead.code, 0, syscallRead.error);
      assert.equal(syscallRead.data, 'link target data');
      assert.equal(globalVFS.resolveSymlinkPath(`${directoryLink}/..`, true, 'hello'), '/home/hello/tests');
      assert.equal(globalVFS.resolveSymlinkPath(`${relativeLink}/..`, true, 'hello'), null);
      assert.equal(globalVFS.resolveSymlinkPath(`${target}/`, true, 'hello'), null);
      assert.equal(globalVFS.writeFile(relativeLink, 'updated through link', 'hello'), true);
      assert.equal(globalVFS.readFile(target, 'hello'), 'updated through link');
      assert.equal(globalVFS.readFile(firstLoop, 'hello'), null);

      const scopedVfs = createCapabilityVfsView(globalVFS, pid, 'hello');
      assert.equal(scopedVfs.readFile(capLink), null);
      globalCapabilityManager.grantCapability(pid, 'CAP_VFS_READ', outside);
      assert.equal(scopedVfs.readFile(capLink), 'outside data');

      globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', directoryLink);
      assert.equal(scopedVfs.writeFile(`${directoryLink}/created-through-link`, 'denied'), false);
      globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', targetDirectory);
      assert.equal(scopedVfs.writeFile(`${directoryLink}/created-through-link`, 'allowed'), true);
      assert.equal(globalVFS.readFile(throughLinkFile, 'hello'), 'allowed');
    } finally {
      globalTaskScheduler.terminateProcess(pid);
      for (const path of [relativeLink, directoryLink, firstLoop, secondLoop, capLink, target, targetDirectory, outside]) {
        globalVFS.remove(path, path === targetDirectory, 'root');
      }
    }
  });
  await report('EAF JavaScript cannot access the mutable process manager', async () => {
    const victim = globalProcessManager.addJob('js-runtime-victim', callerPid);
    try {
      const context = {
        vfs: createCapabilityVfsView(globalVFS, callerPid, 'hello'),
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello' },
        lang: 'en',
        args: [],
        processManager: globalProcessManager,
        callerPid,
        syscall: syscallCtx(callerPid),
      };
      const result = await globalJsEngine.executeJsBundle(
        `async function main(ctx) { if (ctx.processManager) { ctx.processManager.removeProcess(${victim.pid}); console.log('manager-exposed'); } else { console.log('process-manager-omitted'); } const identity = await ctx.syscall(39); console.log('child-identity', ctx.callerPid !== ${callerPid} && identity.data === ctx.callerPid); }`,
        context,
      );
      assert.match(result.stdout, /process-manager-omitted/, JSON.stringify(result));
      assert.match(result.stdout, /child-identity true/, JSON.stringify(result));
      assert.equal(globalTaskScheduler.getProcess(victim.pid)?.state, 'RUNNING');
    } finally {
      globalProcessManager.killJob(victim.jobId);
    }
  });
  await report('aborting EAF execution cancels its in-flight network syscall', async () => {
    const process = globalProcessManager.addJob('eaf-network-abort-check', callerPid);
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    let markFetchStarted;
    let fetchWasAborted = false;
    const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
    globalCapabilityManager.grantCapability(process.pid, 'CAP_NET_ADMIN', 'https://abort.test');
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      const signal = options?.signal;
      if (!(signal instanceof AbortSignal)) {
        markFetchStarted();
        reject(new Error('netd did not receive an AbortSignal'));
        return;
      }
      const onAbort = () => {
        fetchWasAborted = true;
        reject(signal.reason || new Error('aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      markFetchStarted();
    });
    try {
      const context = {
        vfs: createCapabilityVfsView(globalVFS, process.pid, 'hello'),
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello' },
        lang: 'en', args: [], processManager: globalProcessManager,
        callerPid: process.pid, syscall: syscallCtx(process.pid), abortSignal: controller.signal,
      };
      const execution = globalJsEngine.executeJsBundle(
        `async function main(ctx) { const result = await ctx.syscall(30, 'https://abort.test'); console.log('network-cancelled', Boolean(result.data?.error)); }`,
        context,
      );
      await fetchStarted;
      controller.abort(new Error('test cancellation'));
      const result = await execution;
      assert.equal(fetchWasAborted, true);
      assert.match(result.stdout, /network-cancelled true/);
    } finally {
      globalThis.fetch = originalFetch;
      globalProcessManager.killJob(process.jobId);
    }
  });
  await report('process exit aborts its in-flight netd fetch', async () => {
    const pid = 8_000_124;
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'netd-exit-abort-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_NET_ADMIN', 'https://exit-cancel.test');
    const originalFetch = globalThis.fetch;
    let markFetchStarted;
    let requestSignal;
    const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options?.signal;
      const onAbort = () => reject(requestSignal.reason || new Error('aborted'));
      if (requestSignal?.aborted) onAbort();
      else requestSignal?.addEventListener('abort', onAbort, { once: true });
      markFetchStarted();
    });
    try {
      const operation = syscallAs(pid, SyscallNo.SYS_NET_FETCH, 'https://exit-cancel.test/data');
      await fetchStarted;
      assert.equal(globalTaskScheduler.terminateProcess(pid), true);
      const result = await operation;
      assert.equal(requestSignal?.aborted, true);
      assert.notEqual(result.code, 0);
      assert.match(result.data?.error || result.error || '', /exited|abort/i);
    } finally {
      globalThis.fetch = originalFetch;
      if (globalTaskScheduler.getProcess(pid)) globalTaskScheduler.terminateProcess(pid);
      globalCapabilityManager.clearCapabilities(pid);
    }
  });
  await report('netd bounds fetch payloads and streamed responses', async () => {
    const pid = 8_000_126;
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'netd-bounds-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_NET_ADMIN', 'https://fetch-bounds.test');
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    let responseCancelled = false;
    try {
      globalThis.fetch = async () => {
        fetchCalls++;
        return {
          status: 200,
          statusText: 'OK',
          ok: true,
          headers: new Headers(),
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1_048_577));
            },
            cancel() { responseCancelled = true; },
          }),
        };
      };
      const oversizedRequest = await syscallAs(pid, SyscallNo.SYS_NET_FETCH, 'https://fetch-bounds.test/data', {
        method: 'POST', body: 'x'.repeat(1_048_577),
      });
      assert.notEqual(oversizedRequest.code, 0);
      assert.match(oversizedRequest.data?.error || '', /Request body exceeds/);
      assert.equal(fetchCalls, 0, 'oversized request must be rejected before browser fetch');

      const oversizedResponse = await syscallAs(pid, SyscallNo.SYS_NET_FETCH, 'https://fetch-bounds.test/data');
      assert.notEqual(oversizedResponse.code, 0);
      assert.match(oversizedResponse.data?.error || '', /Response exceeds/);
      assert.equal(responseCancelled, true, 'oversized streamed response should be cancelled');
    } finally {
      globalThis.fetch = originalFetch;
      if (globalTaskScheduler.getProcess(pid)) globalTaskScheduler.terminateProcess(pid);
      globalCapabilityManager.clearCapabilities(pid);
    }
  });
  await report('process exit aborts remote LLM inference started by driverd', async () => {
    const pid = 8_000_125;
    const configPath = '/etc/llm.conf';
    const originalConfig = globalVFS.readFile(configPath, 'root');
    const baseUrl = 'https://llm-exit-cancel.test/v1';
    globalVFS.writeFile(configPath, [
      'BASE_URL=' + baseUrl,
      'MODEL_NAME=verification-model',
      'API_KEY=verification-key',
      'ENABLE_LOCAL_MOCK=false',
    ].join('\n') + '\n', 'root');
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'driverd-exit-abort-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_DEVICE_IO', '/dev/ai');
    globalCapabilityManager.grantCapability(pid, 'CAP_NET_ADMIN', baseUrl);
    const originalFetch = globalThis.fetch;
    let markFetchStarted;
    let requestSignal;
    const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options?.signal;
      const onAbort = () => reject(requestSignal.reason || new Error('aborted'));
      if (requestSignal?.aborted) onAbort();
      else requestSignal?.addEventListener('abort', onAbort, { once: true });
      markFetchStarted();
    });
    try {
      const operation = syscallAs(pid, SyscallNo.SYS_INFER, 'cancel when caller exits');
      await fetchStarted;
      assert.equal(globalTaskScheduler.terminateProcess(pid), true);
      const result = await operation;
      assert.equal(requestSignal?.aborted, true);
      assert.notEqual(result.code, 0);
      assert.match(result.error || '', /exited|abort/i);
    } finally {
      globalThis.fetch = originalFetch;
      if (globalTaskScheduler.getProcess(pid)) globalTaskScheduler.terminateProcess(pid);
      globalCapabilityManager.clearCapabilities(pid);
      if (originalConfig !== null) globalVFS.writeFile(configPath, originalConfig, 'root');
    }
  });
  await report('VFSd does not commit a write after the caller exits', async () => {
    const pid = 8_000_126;
    const path = '/home/hello/.vfsd-exit-write-probe';
    const revokedPid = 8_000_127;
    const revokedPath = '/home/hello/.vfsd-revoked-write-probe';
    assert.equal(globalVFS.writeFile(path, 'before', 'hello'), true);
    assert.equal(globalVFS.writeFile(revokedPath, 'before', 'hello'), true);
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'vfsd-exit-write-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', path);
    globalTaskScheduler.createProcess({
      pid: revokedPid, ppid: callerPid, name: 'vfsd-revoked-write-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(revokedPid, 'CAP_VFS_WRITE', revokedPath);
    try {
      const operation = syscallAs(pid, SyscallNo.SYS_WRITE, path, 'after');
      assert.equal(globalTaskScheduler.terminateProcess(pid), true);
      const result = await operation;
      assert.notEqual(result.code, 0);
      assert.equal(globalVFS.readFile(path, 'hello'), 'before');
      const revokedOperation = syscallAs(revokedPid, SyscallNo.SYS_WRITE, revokedPath, 'after');
      assert.equal(globalCapabilityManager.revokeCapability(revokedPid, 'CAP_VFS_WRITE', revokedPath), true);
      const revokedResult = await revokedOperation;
      assert.notEqual(revokedResult.code, 0);
      assert.equal(globalVFS.readFile(revokedPath, 'hello'), 'before');
    } finally {
      if (globalTaskScheduler.getProcess(pid)) globalTaskScheduler.terminateProcess(pid);
      if (globalTaskScheduler.getProcess(revokedPid)) globalTaskScheduler.terminateProcess(revokedPid);
      globalCapabilityManager.clearCapabilities(pid);
      globalCapabilityManager.clearCapabilities(revokedPid);
      globalVFS.remove(path, false, 'root');
      globalVFS.remove(revokedPath, false, 'root');
    }
  });
  await report('shell redirection uses vfsd and device writes cannot fall through to raw VFS', async () => {
    const shell = new ShellEngine(globalVFS, globalProcessManager);
    const path = '/home/hello/.redirect-verification';
    assert.equal((await shell.execute(`echo first > ${path}`)).exitCode, 0);
    assert.equal((await shell.execute(`echo second >> ${path}`)).exitCode, 0);
    assert.equal(globalVFS.readFile(path, 'hello'), 'first\nsecond\n');
    assert.equal(globalVFS.remove(path, false, 'hello'), true);

    const aiWrite = await shell.execute('echo local-ai-check > /dev/ai');
    assert.equal(aiWrite.exitCode, 0, aiWrite.stderr);
    const networkWrite = await shell.execute('echo https://example.invalid > /dev/net/fetch');
    assert.notEqual(networkWrite.exitCode, 0);
    assert.equal(globalVFS.writeFile('/dev/ttyUSB0', 'should-not-dispatch', 'root'), false);
    try {
      shell.setAuthenticatedUser('root');
      const skillDeviceWrite = await shell.execute('echo unapproved-skill > /dev/skill');
      assert.notEqual(skillDeviceWrite.exitCode, 0);
      assert.match(skillDeviceWrite.stderr, /explicit permission grants/);
    } finally {
      shell.setAuthenticatedUser('hello');
    }
  });
  await report('VFS view pins the authenticated user and returns detached directory snapshots', () => {
    const view = createCapabilityVfsView(globalVFS, callerPid, 'hello');
    assert.equal(view.readFile('/etc/passwd', 'root') !== null, true);
    assert.equal(view.readFile('/etc/shadow', 'root'), null);
    assert.equal(view.writeFile('/etc/shadow', 'attacker', 'root'), false);
    const directorySnapshot = view.getNodeByPath('/home/hello');
    assert.ok(directorySnapshot && directorySnapshot.children && directorySnapshot.children.size > 0);
    const originalNode = globalVFS.getNodeByPath('/home/hello');
    const original = originalNode?.children?.size;
    const originalUpdatedAt = originalNode?.updatedAt.getTime();
    assert.notEqual(directorySnapshot.updatedAt, originalNode?.updatedAt);
    directorySnapshot.updatedAt.setTime(0);
    assert.equal(originalNode?.updatedAt.getTime(), originalUpdatedAt, 'mutating a detached Date must not change backing VFS metadata');
    directorySnapshot.children.clear();
    assert.equal(globalVFS.getNodeByPath('/home/hello')?.children?.size, original);
  });
  await report('VFS directory snapshots fail with E2BIG before unbounded cloning', async () => {
    const path = `/home/hello/tests/.snapshot-budget-${Date.now()}`;
    assert.equal(globalVFS.mkdir(path, true), true);
    const directory = globalVFS.getNodeByPath(path, 'root');
    assert.ok(directory?.children);
    const timestamp = new Date();
    for (let index = 0; index < 10_001; index++) {
      const name = `entry-${index}`;
      directory.children.set(name, {
        id: name, name, type: 'file', permissions: 'rw-r--r--', owner: 'hello', group: 'hello',
        size: 0, updatedAt: timestamp, content: '', parent: directory,
      });
    }
    try {
      const shell = new ShellEngine(globalVFS, globalProcessManager);
      const result = await shell.execute(`ls ${path}`);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /E2BIG: VFS node snapshot exceeds the 10,000-node limit/);
    } finally {
      directory.children.clear();
      globalVFS.remove(path, true, 'root');
    }
  });
  await report('VFS snapshot content budget counts UTF-8 bytes without encoding a full copy', async () => {
    const path = `/home/hello/tests/.snapshot-content-budget-${Date.now()}`;
    assert.equal(globalVFS.mkdir(path, true), true);
    const directory = globalVFS.getNodeByPath(path, 'root');
    assert.ok(directory?.children);
    const timestamp = new Date();
    const content = '界'.repeat(11_000);
    for (let index = 0; index < 1_020; index++) {
      const name = `unicode-${index}`;
      directory.children.set(name, {
        id: name, name, type: 'file', permissions: 'rw-r--r--', owner: 'hello', group: 'hello',
        size: content.length * 3, updatedAt: timestamp, content, parent: directory,
      });
    }
    try {
      const view = createCapabilityVfsView(globalVFS, callerPid, 'hello');
      assert.throws(() => view.getNodeByPath(path), /E2BIG: VFS node snapshot exceeds the 32 MiB content limit/);
    } finally {
      directory.children.clear();
      globalVFS.remove(path, true, 'root');
    }
  });
  await report('interactive PID has scoped user defaults and VFS honors authenticated process identity', async () => {
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_READ', '/home/hello/file'), true);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_READ', '/root/.ssh/id_rsa'), false);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_WRITE', '/tmp/output'), true);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_WRITE', '/etc/hosts'), false);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_NET_ADMIN'), false);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_DEVICE_IO', '/dev/wayland'), true);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_DEVICE_IO', '/dev/fb0'), true);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_DEVICE_IO', '/dev/gps0'), false);
    const shell = new ShellEngine(globalVFS, globalProcessManager);
    const endpoint = globalIPCBus.getProcessEndpoint(callerPid);
    const userRead = await globalIPCBus.sendIPC(endpoint, 'vfsd', 'SYS_READ', { path: '/etc/shadow' });
    assert.equal(userRead.content, null);
    try {
      shell.setAuthenticatedUser('root');
      assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_SYS_ADMIN'), true);
      assert.equal(globalTaskScheduler.getProcess(callerPid)?.user, 'root');
      const rootRead = await globalIPCBus.sendIPC(endpoint, 'vfsd', 'SYS_READ', { path: '/etc/shadow' });
      assert.match(rootRead.content, /root:123456:/);
    } finally {
      shell.setAuthenticatedUser('hello');
    }
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_SYS_ADMIN'), false);
    assert.equal(globalTaskScheduler.getProcess(callerPid)?.user, 'hello');
  });
  await report('VFS daemon rejects IPC identities without a live process control block', async () => {
    const phantomPid = 987654;
    const endpoint = globalIPCBus.registerProcess(phantomPid);
    try {
      const result = await globalIPCBus.sendIPC(endpoint, 'vfsd', 'SYS_READ', { path: '/etc/passwd' });
      assert.match(result.error, /ESRCH/);
      assert.equal(globalTaskScheduler.getProcess(phantomPid), null);
    } finally {
      globalIPCBus.unregisterProcess(phantomPid);
    }
  });
  await report('hardware driver actions require a path-scoped CAP_DEVICE_IO grant', async () => {
    const endpoint = globalIPCBus.getProcessEndpoint(callerPid);
    const denied = await globalIPCBus.sendIPC(endpoint, 'driverd', 'DEV_READ_GPS0', {});
    assert.match(denied.error, /CAP_DEVICE_IO/);
    globalCapabilityManager.grantCapability(callerPid, 'CAP_DEVICE_IO', '/dev/gps0');
    try {
      const allowed = await globalIPCBus.sendIPC(endpoint, 'driverd', 'DEV_READ_GPS0', {});
      assert.equal(allowed.device, '/dev/gps0');
    } finally {
      globalCapabilityManager.revokeCapability(callerPid, 'CAP_DEVICE_IO', '/dev/gps0');
    }
  });
  await report('AI inference and direct driver IPC require the scoped /dev/ai capability', async () => {
    const pid = 8_000_221;
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'no-ai-capability-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    try {
      const inference = await syscallAs(pid, SyscallNo.SYS_INFER, 'unauthorized inference');
      assert.equal(inference.code, -1);
      assert.match(inference.error, /CAP_DEVICE_IO.*\/dev\/ai/);
      const endpoint = globalIPCBus.getProcessEndpoint(pid);
      for (const action of ['SYS_INFER', 'DEV_WRITE_AI', 'DEV_READ_AI']) {
        const result = await globalIPCBus.sendIPC(endpoint, 'driverd', action, { prompt: 'unauthorized inference' });
        assert.match(result.error, /CAP_DEVICE_IO.*\/dev\/ai/);
      }
    } finally {
      globalTaskScheduler.terminateProcess(pid);
    }
  });
  const forkChild = async (name, cwd = '/home/hello') => {
    const result = await syscallAs(callerPid, SyscallNo.SYS_FORK, name, cwd);
    assert.equal(result.code, 0, result.error);
    assert.equal(Number.isSafeInteger(result.data), true);
    return result.data;
  };
  const exitAndWait = async (pid, code) => {
    const exited = await syscallAs(pid, SyscallNo.SYS_EXIT, code);
    assert.equal(exited.code, 0, exited.error);
    const waited = await syscallAs(callerPid, SyscallNo.SYS_WAITPID, pid);
    assert.equal(waited.code, 0, waited.error);
    assert.equal(waited.data.status, code);
    assert.equal(globalTaskScheduler.getProcess(pid), null);
  };
  await report('relative VFS paths resolve against each process PCB cwd', async () => {
    const root = `/home/hello/.process-cwd-${Date.now()}`;
    const parentCwd = `${root}/parent`;
    const childCwd = `${root}/child`;
    const originalGlobalCwd = globalVFS.getPwd();
    let forkedPid;
    let interactiveShell;
    try {
      assert.equal(globalVFS.mkdir(parentCwd, true), true);
      assert.equal(globalVFS.mkdir(childCwd, true), true);
      assert.equal(globalVFS.writeFile(`${parentCwd}/marker.txt`, 'parent cwd', 'hello'), true);
      assert.equal(globalVFS.writeFile(`${childCwd}/marker.txt`, 'child cwd', 'hello'), true);
      forkedPid = await forkChild('process-cwd-probe', childCwd);
      assert.equal(globalVFS.changeDirectory(parentCwd, 'hello'), true);
      interactiveShell = new ShellEngine(globalVFS, globalProcessManager);
      interactiveShell.setProcessCwd(globalVFS.getPwd());
      assert.equal(globalTaskScheduler.getProcess(callerPid)?.cwd, parentCwd);
      assert.equal(interactiveShell.getEnv('PWD'), parentCwd);
      const result = await syscallAs(forkedPid, SyscallNo.SYS_READ, 'marker.txt');
      assert.equal(result.code, 0, result.error);
      assert.equal(result.data, 'child cwd');
      const view = createCapabilityVfsView(globalVFS, forkedPid, 'hello');
      assert.equal(view.getPwd(), childCwd);
      assert.equal(view.readFile('marker.txt'), 'child cwd');
    } finally {
      if (forkedPid !== undefined) await exitAndWait(forkedPid, 0);
      globalVFS.changeDirectory(originalGlobalCwd, 'root');
      interactiveShell?.setProcessCwd(originalGlobalCwd);
      globalVFS.remove(root, true, 'root');
    }
  });

  await report('Skill max_turns is finite and capped at the parser boundary', () => {
    const oversized = parseSkillContent('---\nname: turn-limit\nmax_turns: 1000000000\n---\nbody');
    assert.equal(oversized.manifest.max_turns, MAX_SKILL_TURNS);
    const infinite = parseSkillContent('---\nname: invalid-turn-limit\nmax_turns: Infinity\n---\nbody');
    assert.equal(infinite.manifest.max_turns, 5);
  });

  await report('Skill source size is rejected before manifest/body parsing', () => {
    assert.throws(
      () => parseSkillContent(`---\nname: oversized\n---\n${'x'.repeat(MAX_SKILL_SOURCE_CHARS)}`),
      /source exceeds the 256000-character limit/,
    );
  });

  await report('installed BATS nested-process smoke suite', async () => {
    const script = await readFile('src/scripts/posix-process-conformance.bats', 'utf8');
    const result = await BatsTestEngine.runBatsScript(script, {
      vfs: globalVFS,
      processManager: globalProcessManager,
      env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
      lang: 'en',
      args: [],
      callerPid,
      syscall: syscallCtx(callerPid),
    });
    assert.equal(result.exitCode, 0, result.tapOutput);
    assert.equal(result.passed, 3);
  });

  await report('shell USER cannot spoof identity and user switching requires authentication', async () => {
    const shell = new ShellEngine(globalVFS, globalProcessManager);
    await shell.execute('export USER=root');
    assert.equal(shell.getEnv('USER'), 'hello');

    const sudoShell = await shell.execute('sudo -i');
    assert.equal(sudoShell.sudoPrompt?.username, 'hello');
    const inlineSpoof = await shell.execute('USER=root cat /etc/shadow');
    assert.notEqual(inlineSpoof.exitCode, 0);
    assert.doesNotMatch(inlineSpoof.stdout, /earendel_hash/);
    await shell.execute('unset USER');
    assert.equal(shell.getEnv('USER'), 'hello');

    const suShell = await shell.execute('su root');
    assert.equal(suShell.sudoPrompt?.username, 'hello');
    assert.equal(suShell.sudoPrompt?.targetUser, 'root');

    shell.setAuthenticatedUser('root');
    assert.equal(shell.getEnv('USER'), 'root');
    shell.setAuthenticatedUser('hello');
  });

  await report('find traversal yields to the event loop and honors cancellation', async () => {
    const find = findSuiteCommands.find((command) => command.name === 'find');
    assert.ok(find);
    const children = new Map();
    for (let index = 0; index < 4096; index++) {
      const name = `entry-${index.toString().padStart(4, '0')}`;
      children.set(name, { name, type: 'file', size: 0, children: undefined });
    }
    const root = { name: 'root', type: 'directory', size: 0, children };
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 0);
    const result = await find.execute({
      args: ['/large'],
      vfs: { getNodeByPath: (path) => path === '/large' ? root : null },
      abortSignal: abortController.signal,
    });
    assert.equal(result.exitCode, 130);
    assert.match(result.stderr, /cancelled/);
  });

  await report('Skill caller cancellation aborts in-flight inference and returns promptly', async () => {
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    const abortController = new AbortController();
    let inferenceSignal;
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        inferenceSignal = payload.signal;
        return new Promise((_resolve, reject) => {
          if (payload.signal.aborted) reject(payload.signal.reason);
          else payload.signal.addEventListener('abort', () => reject(payload.signal.reason), { once: true });
        });
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const engine = new HarnessEngine();
      const execCtx = {
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [], processManager: globalProcessManager, callerPid,
        syscall: syscallCtx(callerPid), abortSignal: abortController.signal,
      };
      const execution = engine.executeSkill('---\nname: cancellation-probe\n---\nExplain the task.', execCtx);
      setTimeout(() => abortController.abort(new Error('caller cancelled Skill')), 0);
      const result = await execution;
      assert.equal(result.exitCode, 1);
      assert.ok(inferenceSignal?.aborted);
      assert.match(result.stderr, /caller cancelled Skill/);
      const auditDir = globalVFS.getNodeByPath('/var/log/harness', 'root');
      const audit = [...(auditDir?.children?.values() || [])]
        .filter((node) => node.type === 'file')
        .flatMap((node) => (node.content || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
        .filter((entry) => entry.skillName === 'cancellation-probe')
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.pid - a.pid)[0];
      assert.ok(audit, 'cancelled Skill must leave a durable audit record');
      assert.equal(audit.status, 'ERROR');
      assert.ok(audit.events.some((event) => event.action === 'capabilities-revoked'));
      assert.deepEqual(globalCapabilityManager.getCapabilityTokens(audit.pid), []);
      assert.equal(globalTaskScheduler.getProcess(audit.pid), null);
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
    }
  });

  await report('interactive shell cancellation reaches an in-flight AI request', async () => {
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    const abortController = new AbortController();
    let inferenceSignal;
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        inferenceSignal = payload.signal;
        return new Promise((_resolve, reject) => {
          if (payload.signal?.aborted) reject(payload.signal.reason);
          else payload.signal?.addEventListener('abort', () => reject(payload.signal.reason), { once: true });
        });
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const shell = new ShellEngine(globalVFS, globalProcessManager);
      shell.abortSignal = abortController.signal;
      const execution = shell.execute('ai analyze this lesson');
      setTimeout(() => abortController.abort(new Error('interactive request cancelled')), 0);
      await assert.rejects(execution, /interactive request cancelled/);
      assert.ok(inferenceSignal?.aborted);
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
    }
  });

  await report('cancelled shell scripts stop before executing later statements', async () => {
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    const abortController = new AbortController();
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        return new Promise((resolve) => payload.signal.addEventListener('abort', () => {
          resolve({ response: 'late response after cancellation', success: true });
        }, { once: true }));
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const shell = new ShellEngine(globalVFS, globalProcessManager);
      shell.abortSignal = abortController.signal;
      const execution = shell.execute('ai wait\necho SHOULD_NOT_RUN');
      setTimeout(() => abortController.abort(new Error('script interrupted')), 0);
      const result = await execution;
      assert.equal(result.exitCode, 130);
      assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/);
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
    }
  });

  await report('MCP transport failures remain failures instead of simulated success', async () => {
    const { McpClientManager } = await server.ssrLoadModule('/src/core/mcpClient.ts');
    const originalConfig = globalVFS.readFile('/etc/mcp.conf', 'root');
    const originalFetch = globalThis.fetch;
    const serverUrl = 'https://mcp.invalid/rpc';
    const { mcpCommand } = await server.ssrLoadModule('/src/core/commands/mcpCommands.ts');
    assert.equal(globalVFS.writeFile('/etc/mcp.conf', JSON.stringify({
      mcpServers: { verification: { url: serverUrl } },
    }), 'root'), true);
    globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Unavailable' });
    try {
      const userListing = await mcpCommand.execute({ callerPid, args: ['list'] });
      assert.match(userListing.stdout, /No MCP servers are authorized/);
      assert.doesNotMatch(userListing.stdout, /mcp\.invalid/);
      const deniedCliCall = await mcpCommand.execute({ callerPid, args: ['call', 'verification', 'probe', '{}'] });
      assert.equal(deniedCliCall.exitCode, 1);
      assert.match(deniedCliCall.stderr, /lacks CAP_NET_ADMIN/);
      const manager = new McpClientManager();
      await assert.rejects(manager.callTool('verification', 'probe', {}, undefined, callerPid), /lacks CAP_NET_ADMIN/);
      assert.equal(globalCapabilityManager.grantCapability(callerPid, 'CAP_NET_ADMIN', serverUrl), true);
      try {
        await assert.rejects(manager.callTool('verification', 'probe', {}, undefined, callerPid), /MCP request.*HTTP Error 503/);
        const allowedCliCall = await mcpCommand.execute({ callerPid, args: ['call', 'verification', 'probe', '{}'] });
        assert.equal(allowedCliCall.exitCode, 1);
        assert.match(allowedCliCall.stderr, /HTTP Error 503/);
      } finally {
        globalCapabilityManager.revokeCapability(callerPid, 'CAP_NET_ADMIN', serverUrl);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalConfig === null) globalVFS.remove('/etc/mcp.conf', false, 'root');
      else globalVFS.writeFile('/etc/mcp.conf', originalConfig, 'root');
    }
  });

  await report('curl and wget propagate denied VFS writes as command failures', async () => {
    const { netArchiveCommands } = await server.ssrLoadModule('/src/core/commands/netArchiveCommands.ts');
    const curl = netArchiveCommands.find((command) => command.name === 'curl');
    const wget = netArchiveCommands.find((command) => command.name === 'wget');
    assert.ok(curl);
    assert.ok(wget);
    const executeWithDeniedWrite = (command, args) => command.execute({
      args,
      abortSignal: undefined,
      syscall: async (sysNo) => sysNo === SyscallNo.SYS_NET_FETCH
        ? { code: 0, data: { ok: true, status: 200, statusText: 'OK', headers: [], body: 'downloaded' } }
        : { code: -1, error: 'EACCES: capability denied' },
    });
    for (const result of [
      await executeWithDeniedWrite(curl, ['-o', '/root/forbidden', 'https://example.invalid/file']),
      await executeWithDeniedWrite(wget, ['-O', '/root/forbidden', 'https://example.invalid/file']),
    ]) {
      assert.equal(result.exitCode === 0, false);
      assert.match(result.stderr, /cannot write .*EACCES/);
      assert.equal(result.stdout, '');
    }
  });

  await report('package and VFS-image network clients enforce caller capabilities', async () => {
    const [{ globalPkgManager }, { globalVFSImageEngine }, { aptCommands }, { vfsCommands }, { checkNetworkRequest }, { globalFirewallEngine }] = await Promise.all([
      server.ssrLoadModule('/src/core/pkgManager.ts'),
      server.ssrLoadModule('/src/core/vfsImageEngine.ts'),
      server.ssrLoadModule('/src/core/commands/aptCommands.ts'),
      server.ssrLoadModule('/src/core/commands/vfsCommands.ts'),
      server.ssrLoadModule('/src/core/networkAccessPolicy.ts'),
      server.ssrLoadModule('/src/core/firewallEngine.ts'),
    ]);
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      throw new Error('network request should have been denied before fetch');
    };
    try {
      const update = await globalPkgManager.updateFromRemoteRepo(callerPid);
      assert.equal(update.success, false);
      assert.match(update.log, /lacks CAP_NET_ADMIN/);
      const install = await globalPkgManager.installPackage('https://packages.invalid/probe.ear.json', callerPid);
      assert.equal(install.success, false);
      assert.match(install.message, /lacks CAP_NET_ADMIN/);
      const aptUpdate = await aptCommands.find((command) => command.name === 'apt').execute({
        callerPid, args: ['update'], env: { USER: 'hello' },
      });
      assert.equal(aptUpdate.exitCode, 1);
      assert.match(aptUpdate.stderr, /lacks CAP_NET_ADMIN/);

      assert.equal(globalVFSImageEngine.setRemoteUrl('https://vfs.invalid', callerPid).success, false);
      assert.equal((await globalVFSImageEngine.setCredential('probe', callerPid)).success, false);
      assert.equal((await globalVFSImageEngine.push(callerPid)).success, false);
      assert.equal((await globalVFSImageEngine.pull(callerPid)).success, false);
      const vfsPush = await vfsCommands.find((command) => command.name === 'vfs').execute({ callerPid, args: ['push'] });
      assert.equal(vfsPush.exitCode, 1);

      const firewallProbeUrl = 'https://policy-probe.invalid/path';
      const rule = globalFirewallEngine.addRule('REJECT', 443, 'tcp', 'any', 'OUTPUT');
      globalCapabilityManager.grantCapability(callerPid, 'CAP_NET_ADMIN', firewallProbeUrl);
      try {
        assert.match(checkNetworkRequest(callerPid, firewallProbeUrl) || '', /simulated firewall \(REJECT\)/);
      } finally {
        globalCapabilityManager.revokeCapability(callerPid, 'CAP_NET_ADMIN', firewallProbeUrl);
        globalFirewallEngine.deleteRule(rule.id);
      }
      const approvedScopes = intersectNetworkScopes(['https://api.skill.invalid/v1'], ['https://api.skill.invalid']);
      assert.deepEqual(approvedScopes, ['https://api.skill.invalid/v1']);
      globalCapabilityManager.grantCapability(callerPid, 'CAP_NET_ADMIN', approvedScopes[0]);
      try {
        assert.equal(checkNetworkRequest(callerPid, 'https://api.skill.invalid/v1/users'), null);
        assert.match(checkNetworkRequest(callerPid, 'https://api.skill.invalid/v10') || '', /lacks CAP_NET_ADMIN/);
        assert.match(checkNetworkRequest(callerPid, 'https://other.skill.invalid/v1') || '', /lacks CAP_NET_ADMIN/);
        assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_NET_ADMIN', 'api.skill.invalid'), true);
        assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_NET_ADMIN', 'API.SKILL.INVALID.'), true);
        assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_NET_ADMIN', 'other.skill.invalid'), false);
        const resolvedApprovedHost = await syscallAs(callerPid, SyscallNo.SYS_NET_RESOLVE, 'api.skill.invalid');
        assert.equal(resolvedApprovedHost.code, 0, resolvedApprovedHost.error);
        assert.equal(resolvedApprovedHost.data.hostname, 'api.skill.invalid');
        const resolvedSiblingHost = await syscallAs(callerPid, SyscallNo.SYS_NET_RESOLVE, 'other.skill.invalid');
        assert.equal(resolvedSiblingHost.code, -1);
        assert.match(resolvedSiblingHost.error, /lacks CAP_NET_ADMIN/);
      } finally {
        globalCapabilityManager.revokeCapability(callerPid, 'CAP_NET_ADMIN', approvedScopes[0]);
      }
      assert.equal(fetchCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await report('process exit closes and forgets owned WebSocket connections', async () => {
    const { globalNetworkDaemon } = await server.ssrLoadModule('/src/kernel/services/netd.ts');
    const pid = 8_000_111;
    const otherPid = 8_000_112;
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'socket-lifecycle-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalTaskScheduler.createProcess({
      pid: otherPid, ppid: callerPid, name: 'socket-owner-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_NET_ADMIN', '*');
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    let closeCalls = 0;
    class FakeWebSocket {
      addEventListener() {}
      close() { closeCalls++; }
    }
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true, writable: true, value: FakeWebSocket,
    });
    try {
      const result = await syscallAs(pid, SyscallNo.SYS_NET_SOCKET, 'wss://socket.invalid/live', 'ws');
      assert.equal(result.code, 0, result.error);
      const sockets = globalNetworkDaemon.activeSockets;
      const [socketId, entry] = [...sockets.entries()].find(([, socket]) => socket.ownerPid === pid) || [];
      assert.ok(socketId);
      assert.ok(entry);
      assert.equal(entry.socket instanceof FakeWebSocket, true);

      const stolenClose = await syscallAs(otherPid, SyscallNo.SYS_NET_CLOSE, socketId);
      assert.equal(stolenClose.code, -1);
      assert.match(stolenClose.error, /EPERM: socket belongs to another process/);
      const closed = await syscallAs(pid, SyscallNo.SYS_NET_CLOSE, socketId);
      assert.equal(closed.code, 0, closed.error);
      assert.equal(closeCalls, 1);
      assert.equal(sockets.has(socketId), false);
      const doubleClose = await syscallAs(pid, SyscallNo.SYS_NET_CLOSE, socketId);
      assert.equal(doubleClose.code, -1);
      assert.match(doubleClose.error, /EBADF/);

      const second = await syscallAs(pid, SyscallNo.SYS_NET_SOCKET, 'wss://socket.invalid/exit-cleanup', 'ws');
      assert.equal(second.code, 0, second.error);
      const secondSocketId = second.data.socketId;
      assert.equal(globalTaskScheduler.exitProcess(pid, 0), true);
      assert.equal(closeCalls, 2);
      assert.equal(sockets.has(secondSocketId), false);
      assert.equal([...sockets.values()].some((socket) => socket.ownerPid === pid), false);
    } finally {
      if (globalTaskScheduler.getProcess(pid)) globalTaskScheduler.terminateProcess(pid);
      if (globalTaskScheduler.getProcess(otherPid)) globalTaskScheduler.terminateProcess(otherPid);
      if (originalDescriptor) Object.defineProperty(globalThis, 'WebSocket', originalDescriptor);
      else delete globalThis.WebSocket;
    }
  });

  await report('Harness rejects remote LLM fallback as a successful inference result', async () => {
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        return { response: '[LLM Network Connection Failure] offline', success: false, transport: 'remote-fallback', error: 'offline' };
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const engine = new HarnessEngine();
      const result = await engine.executeSkill('---\nname: llm-failure-probe\n---\nComplete the task.', {
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [], processManager: globalProcessManager, callerPid,
        syscall: syscallCtx(callerPid),
      });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /offline/);
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
    }
  });

  await report('Skills receive only the caller-approved network URL prefixes', async () => {
    const skillPath = '/home/hello/tests/.skill-network-scope-probe.md';
    const content = [
      '---',
      'name: network-scope-probe',
      'permissions: {"network":true,"network_hosts":["https://api.skill.invalid/v1"]}',
      'max_turns: 1',
      '---',
      'Report readiness without making a network request.',
    ].join('\n');
    assert.equal(globalVFS.writeFile(skillPath, content, 'hello'), true);
    const deniedSkillPath = '/home/hello/tests/.skill-network-command-scope-probe.md';
    const deniedContent = [
      '---',
      'name: network-command-scope-probe',
      'tools: {"system":["curl"]}',
      'permissions: {"network":true,"network_hosts":["https://api.skill.invalid/v1"]}',
      'max_turns: 1',
      '---',
      'Request data from the declared API.',
    ].join('\n');
    assert.equal(globalVFS.writeFile(deniedSkillPath, deniedContent, 'hello'), true);
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') return { response: 'Ready.', transport: 'verification' };
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const { skillCommand } = await server.ssrLoadModule('/src/core/commands/skillCommands.ts');
      const result = await skillCommand.execute({
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [skillPath, '--grant-network-host=https://api.skill.invalid'],
        processManager: globalProcessManager, callerPid, syscall: syscallCtx(callerPid),
      });
      assert.equal(result.exitCode, 0, result.stderr);
      const auditDir = globalVFS.getNodeByPath('/var/log/harness', 'root');
      const record = [...(auditDir?.children?.values() || [])]
        .filter((node) => node.type === 'file')
        .flatMap((node) => (node.content || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
        .filter((entry) => entry.skillName === 'network-scope-probe')
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.pid - a.pid)[0];
      assert.ok(record);
      assert.equal(record.status, 'SUCCESS');
      assert.ok(record.capabilities.some((capability) => capability.type === 'CAP_NET_ADMIN' && capability.scope === 'https://api.skill.invalid/v1'));
      assert.equal(record.capabilities.some((capability) => capability.type === 'CAP_NET_ADMIN' && capability.scope === '*'), false);
      assert.deepEqual(globalCapabilityManager.getCapabilityTokens(record.pid), []);
      assert.equal(globalTaskScheduler.getProcess(record.pid), null);

      const broadApprovalResult = await skillCommand.execute({
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [skillPath, '--grant-network'],
        processManager: globalProcessManager, callerPid, syscall: syscallCtx(callerPid),
      });
      assert.equal(broadApprovalResult.exitCode, 0, broadApprovalResult.stderr);
      const broadlyApprovedRecord = [...(auditDir?.children?.values() || [])]
        .filter((node) => node.type === 'file')
        .flatMap((node) => (node.content || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
        .filter((entry) => entry.skillName === 'network-scope-probe')
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.pid - a.pid)[0];
      assert.ok(broadlyApprovedRecord);
      assert.equal(broadlyApprovedRecord.status, 'SUCCESS');
      assert.ok(broadlyApprovedRecord.capabilities.some((capability) => capability.type === 'CAP_NET_ADMIN' && capability.scope === 'https://api.skill.invalid/v1'));
      assert.equal(broadlyApprovedRecord.capabilities.some((capability) => capability.type === 'CAP_NET_ADMIN' && capability.scope === '*'), false);
      assert.deepEqual(globalCapabilityManager.getCapabilityTokens(broadlyApprovedRecord.pid), []);
      assert.equal(globalTaskScheduler.getProcess(broadlyApprovedRecord.pid), null);

      let networkFetchAttempts = 0;
      globalIPCBus.sendIPC = async (sender, service, action, payload) => {
        if (service === 'driverd' && action === 'DEV_WRITE_AI') {
          return { response: ['```bash', 'curl https://evil.skill.invalid/collect', '```'].join('\n'), success: true, transport: 'verification' };
        }
        if (service === 'netd' && action === 'SYS_NET_FETCH') networkFetchAttempts++;
        return originalSendIPC(sender, service, action, payload);
      };
      const deniedCommand = await skillCommand.execute({
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [deniedSkillPath, '--grant-tool=curl', '--grant-network-host=https://api.skill.invalid'],
        processManager: globalProcessManager, callerPid, syscall: syscallCtx(callerPid),
      });
      assert.equal(deniedCommand.exitCode, 1);
      assert.equal(networkFetchAttempts, 0, 'out-of-scope curl must be denied before it reaches netd');
      const deniedCommandRecord = [...(auditDir?.children?.values() || [])]
        .filter((node) => node.type === 'file')
        .flatMap((node) => (node.content || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
        .filter((entry) => entry.skillName === 'network-command-scope-probe')
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.pid - a.pid)[0];
      assert.ok(deniedCommandRecord);
      assert.ok(deniedCommandRecord.events.some((event) =>
        event.action === 'command-denied' && /caller-approved network scope/.test(event.detail)));

      let approvedFetchAttempts = 0;
      globalIPCBus.sendIPC = async (sender, service, action, payload) => {
        if (service === 'driverd' && action === 'DEV_WRITE_AI') {
          return { response: ['```bash', 'curl https://api.skill.invalid/v1/data', '```'].join('\n'), success: true, transport: 'verification' };
        }
        if (service === 'netd' && action === 'SYS_NET_FETCH') {
          approvedFetchAttempts++;
          return { status: 200, statusText: 'OK', ok: true, body: 'scoped response' };
        }
        return originalSendIPC(sender, service, action, payload);
      };
      const approvedCommand = await skillCommand.execute({
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [deniedSkillPath, '--grant-tool=curl', '--grant-network-host=https://api.skill.invalid'],
        processManager: globalProcessManager, callerPid, syscall: syscallCtx(callerPid),
      });
      assert.equal(approvedCommand.exitCode, 0, approvedCommand.stderr);
      assert.equal(approvedFetchAttempts, 1, 'a caller-approved curl URL should reach netd exactly once');
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
      globalVFS.remove(skillPath, false, 'root');
      globalVFS.remove(deniedSkillPath, false, 'root');
    }
  });

  await report('Skill grants require caller approval and output is capped before persistence', async () => {
    const path = '/home/hello/tests/.skill-large-output';
    assert.equal(globalVFS.writeFile(path, 'x'.repeat(70_000), 'hello'), true);
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    const originalWriteScratchpad = globalAgentMemoryManager.writeScratchpad.bind(globalAgentMemoryManager);
    const originalAppendSessionAudit = globalAgentMemoryManager.appendSessionAudit.bind(globalAgentMemoryManager);
    let persistedOutput;
    let responsePath = path;
    globalAgentMemoryManager.writeScratchpad = (vfs, pid, filename, content) => {
      if (filename.startsWith('stdout_')) persistedOutput = content;
      return originalWriteScratchpad(vfs, pid, filename, content);
    };
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        return { response: ['```bash', `cat ${responsePath}`, '```'].join('\n'), transport: 'verification' };
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const engine = new HarnessEngine();
      const skillContent = [
        '---',
        'name: output-limit-probe',
        'tools: {"system":["cat"]}',
        'permissions: {"vfs_read":["*"]}',
        'max_turns: 1',
        '---',
        'Read the declared test file.',
      ].join('\n');
      const execCtx = {
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en',
        args: [],
        processManager: globalProcessManager,
        callerPid,
        syscall: syscallCtx(callerPid),
      };
      const latestAuditFor = (skillName) => {
        const auditDir = globalVFS.getNodeByPath('/var/log/harness', 'root');
        return [...(auditDir?.children?.values() || [])]
          .filter((node) => node.type === 'file')
          .flatMap((node) => (node.content || '').split('\n').filter(Boolean)
            .map((line) => ({ node, record: JSON.parse(line) })))
          .filter(({ record }) => record.skillName === skillName)
          .sort((a, b) => b.record.timestamp.localeCompare(a.record.timestamp) || b.record.pid - a.record.pid)[0];
      };
      const assertFailedSkillWasAuditedAndReaped = (audit) => {
        assert.ok(audit, 'failed Skill must leave a persisted audit record');
        assert.equal(audit.record.status, 'ERROR');
        assert.ok(audit.record.events.some((event) => event.action === 'capabilities-revoked'));
        assert.equal(globalTaskScheduler.getProcess(audit.record.pid), null, 'failed Skill must not leave a live process');
        assert.deepEqual(globalCapabilityManager.getCapabilityTokens(audit.record.pid), [], 'failed Skill must leave no residual capabilities');
        assert.equal(audit.node.owner, 'root');
        assert.equal(audit.node.permissions, 'rw-------');
      };
      const unapproved = await engine.executeSkill(skillContent, execCtx);
      assert.equal(unapproved.exitCode, 1);
      assert.match(unapproved.stdout, /not explicitly permitted by skill tools\.system/);
      const deniedAudit = latestAuditFor('output-limit-probe');
      assertFailedSkillWasAuditedAndReaped(deniedAudit);
      assert.ok(deniedAudit.record.events.some((event) => event.action === 'command-denied'));

      const fileGrant = { vfs_read: [path], system_tools: ['cat'] };
      responsePath = '/etc/passwd';
      const outsideScope = await engine.executeSkill(skillContent, execCtx, undefined, undefined, fileGrant);
      assert.equal(outsideScope.exitCode, 1);
      assert.match(outsideScope.stdout, /outside permissions\.vfs_read/);
      const scopeViolationAudit = latestAuditFor('output-limit-probe');
      assertFailedSkillWasAuditedAndReaped(scopeViolationAudit);
      assert.ok(scopeViolationAudit.record.events.some((event) =>
        event.action === 'command-denied' || event.action === 'command-failure'));

      responsePath = path;
      const skillPath = '/home/hello/tests/.skill-permission-probe.md';
      assert.equal(globalVFS.writeFile(skillPath, skillContent, 'hello'), true);
      const { skillCommand } = await server.ssrLoadModule('/src/core/commands/skillCommands.ts');
      const result = await skillCommand.execute({
        ...execCtx,
        args: [skillPath, `--grant-read=${path}`, '--grant-tool=cat'],
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stdout, /Output \(640\d\d chars\) saved/);
      assert.doesNotMatch(result.stdout, /x{70000}/);
      assert.ok(persistedOutput.length < 70_000);
      assert.match(persistedOutput, /Skill output truncated at 64000 characters/);
      const auditDir = globalVFS.getNodeByPath('/var/log/harness', 'root');
      const auditFiles = [...(auditDir?.children?.values() || [])].filter((node) => node.type === 'file');
      const auditEntry = auditFiles
        .flatMap((node) => (node.content || '').split('\n').filter(Boolean)
          .map((line) => ({ node, record: JSON.parse(line) })))
        .filter(({ record }) => record.skillName === 'output-limit-probe')
        .sort((left, right) => right.record.timestamp.localeCompare(left.record.timestamp))[0];
      assert.ok(auditEntry, 'successful Skill run must leave a session audit record');
      assert.equal(auditEntry.record.status, 'SUCCESS');
      assert.ok(auditEntry.record.capabilities.some((capability) => capability.type === 'CAP_VFS_READ' && capability.scope === path));
      assert.ok(auditEntry.record.events.some((event) => event.action === 'command-success'));
      assert.ok(auditEntry.record.events.some((event) => event.action === 'capabilities-revoked'));
      assert.equal(globalTaskScheduler.getProcess(auditEntry.record.pid), null, 'completed Skill must not leave a live process');
      assert.deepEqual(globalCapabilityManager.getCapabilityTokens(auditEntry.record.pid), [], 'completed Skill must leave no residual capability grants');
      assert.equal(auditEntry.node.owner, 'root');
      assert.equal(auditEntry.node.permissions, 'rw-------');

      globalAgentMemoryManager.appendSessionAudit = () => false;
      const unaudited = await engine.executeSkill(skillContent, execCtx, undefined, undefined, fileGrant);
      assert.equal(unaudited.exitCode, 1);
      assert.match(unaudited.stderr, /session audit record could not be persisted/);
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
      globalAgentMemoryManager.writeScratchpad = originalWriteScratchpad;
      globalAgentMemoryManager.appendSessionAudit = originalAppendSessionAudit;
      globalVFS.remove(path, false, 'root');
      globalVFS.remove('/home/hello/tests/.skill-permission-probe.md', false, 'root');
    }
  });

  await report('Skill references and inherited memory are bounded before LLM prompt assembly', async () => {
    const referencePath = '/home/hello/tests/.skill-large-reference';
    const profilePath = '/home/hello/.agent_profile';
    const originalProfile = globalVFS.readFile(profilePath, 'hello');
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    let capturedPrompt = '';
    assert.equal(globalVFS.writeFile(referencePath, 'R'.repeat(80_000), 'hello'), true);
    assert.equal(globalVFS.writeFile(profilePath, 'P'.repeat(20_000), 'hello'), true);
    globalIPCBus.sendIPC = async (sender, service, action, payload) => {
      if (service === 'driverd' && action === 'DEV_WRITE_AI') {
        capturedPrompt = payload.prompt;
        return { response: 'Task complete.', success: true, transport: 'verification' };
      }
      return originalSendIPC(sender, service, action, payload);
    };
    try {
      const skillContent = [
        '---',
        'name: prompt-bound-probe',
        `references: ["${referencePath}"]`,
        `permissions: {"vfs_read":["${referencePath}"]}`,
        'context_mode: inherit',
        '---',
        'Inspect the supplied reference.',
      ].join('\n');
      const result = await new HarnessEngine().executeSkill(skillContent, {
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [], processManager: globalProcessManager, callerPid,
        syscall: syscallCtx(callerPid),
      }, undefined, undefined, { vfs_read: [referencePath], memory: true });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(capturedPrompt.length < 40_000, `bounded prompt unexpectedly has ${capturedPrompt.length} characters`);
      assert.match(capturedPrompt, /Reference truncated by Skill context limit/);
      assert.match(capturedPrompt, /Agent memory truncated for context limit/);

      const oversizedBody = `---\nname: oversized-body\n---\n${'I'.repeat(50_000)}`;
      capturedPrompt = '';
      const rejected = await new HarnessEngine().executeSkill(oversizedBody, {
        vfs: globalVFS,
        env: { USER: 'hello', HOME: '/home/hello', PWD: '/home/hello', PATH: '/bin:/usr/bin' },
        lang: 'en', args: [], processManager: globalProcessManager, callerPid,
        syscall: syscallCtx(callerPid),
      });
      assert.equal(rejected.exitCode, 1);
      assert.match(rejected.stderr, /instructions exceed/);
      assert.equal(capturedPrompt, '', 'oversized Skill body must fail before LLM inference');
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
      if (originalProfile === null) globalVFS.remove(profilePath, false, 'hello');
      else globalVFS.writeFile(profilePath, originalProfile, 'hello');
      globalVFS.remove(referencePath, false, 'root');
    }
  });

  await report('waitpid blocks until child exit, returns status, and releases process page', async () => {
    const before = globalVMPageTable.getMemoryMetrics().allocatedFrames;
    const childPid = await forkChild('waitpid-probe');
    assert.equal(globalVMPageTable.getMemoryMetrics().allocatedFrames, before + 1);
    let settled = false;
    const waiting = syscallAs(callerPid, SyscallNo.SYS_WAITPID, childPid).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(settled, false, 'waitpid returned while the child was still running');
    const exited = await syscallAs(childPid, SyscallNo.SYS_EXIT, 7);
    assert.equal(exited.code, 0, exited.error);
    const result = await waiting;
    assert.equal(result.code, 0, result.error);
    assert.equal(result.data.status, 7);
    assert.equal(globalTaskScheduler.getProcess(childPid), null);
    assert.equal(globalVMPageTable.getMemoryMetrics().allocatedFrames, before);
  });
  await report('process exit closes descriptor tables before waitpid reaps the zombie', async () => {
    const pid = 8_000_128;
    const fds = new Map([
      [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
      [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
      [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      [3, { fd: 3, path: '/tmp/exit-fd-probe', offset: 0, flags: 'rw' }],
    ]);
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'exit-fd-cleanup-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello', fds,
    });
    const exited = await syscallAs(pid, SyscallNo.SYS_EXIT, 23);
    assert.equal(exited.code, 0, exited.error);
    assert.equal(globalTaskScheduler.getProcess(pid)?.state, 'ZOMBIE');
    assert.equal(fds.size, 0, 'open descriptor references must be released at exit, not reap');
    const waited = await syscallAs(callerPid, SyscallNo.SYS_WAITPID, pid);
    assert.equal(waited.code, 0, waited.error);
    assert.equal(waited.data.status, 23);
    assert.equal(globalTaskScheduler.getProcess(pid), null);
  });

  await report('fork duplicates descriptors and shares open-file offset', async () => {
    const path = `/home/hello/tests/.posix-fd-${Date.now()}`;
    assert.equal(globalVFS.writeFile(path, 'abcdef', 'hello'), true);
    const opened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, path, 'r');
    assert.equal(opened.code, 0, opened.error);
    const fd = opened.data;
    const childPid = await forkChild('fd-inheritance-probe');
    try {
      const childRead = await syscallAs(childPid, SyscallNo.SYS_READ, fd, 2);
      assert.equal(childRead.code, 0, childRead.error);
      assert.equal(childRead.data, 'ab');
      const parentRead = await syscallAs(callerPid, SyscallNo.SYS_READ, fd, 2);
      assert.equal(parentRead.code, 0, parentRead.error);
      assert.equal(parentRead.data, 'cd');
    } finally {
      await exitAndWait(childPid, 0);
      await syscallAs(callerPid, SyscallNo.SYS_CLOSE, fd);
      globalVFS.remove(path, false, 'root');
    }
  });

  await report('descriptor offsets, counts, append, and write results use UTF-8 byte lengths', async () => {
    const path = `/home/hello/tests/.posix-utf8-fd-${Date.now()}`;
    assert.equal(globalVFS.writeFile(path, '你a🙂', 'hello'), true);
    const opened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, path, 'r');
    assert.equal(opened.code, 0, opened.error);
    try {
      const first = await syscallAs(callerPid, SyscallNo.SYS_READ, opened.data, 3);
      assert.equal(first.data, '你');
      const second = await syscallAs(callerPid, SyscallNo.SYS_READ, opened.data, 1);
      assert.equal(second.data, 'a');
      const third = await syscallAs(callerPid, SyscallNo.SYS_READ, opened.data, 4);
      assert.equal(third.data, '🙂');
      const eof = await syscallAs(callerPid, SyscallNo.SYS_READ, opened.data, 1);
      assert.equal(eof.data, '');
      const end = await syscallAs(callerPid, SyscallNo.SYS_LSEEK, opened.data, 0, 2);
      assert.equal(end.data, 8, 'SEEK_END must use encoded byte length');
    } finally {
      await syscallAs(callerPid, SyscallNo.SYS_CLOSE, opened.data);
    }

    const append = await syscallAs(callerPid, SyscallNo.SYS_OPEN, path, 'a');
    assert.equal(append.code, 0, append.error);
    try {
      const written = await syscallAs(callerPid, SyscallNo.SYS_WRITE, append.data, '中');
      assert.equal(written.code, 0, written.error);
      assert.equal(written.data, 3, 'write result must report bytes, not UTF-16 code units');
      assert.equal(globalVFS.readFile(path, 'root'), '你a🙂中');
    } finally {
      await syscallAs(callerPid, SyscallNo.SYS_CLOSE, append.data);
      globalVFS.remove(path, false, 'root');
    }
  });

  await report('VFS enforces a file-size limit before sparse descriptor allocation', async () => {
    const path = `/home/hello/tests/.posix-file-cap-${Date.now()}`;
    assert.equal(globalVFS.writeFile(path, 'keep', 'hello'), true);
    const opened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, path, 'rw');
    assert.equal(opened.code, 0, opened.error);
    try {
      const seek = await syscallAs(callerPid, SyscallNo.SYS_LSEEK, opened.data, 32 * 1024 * 1024, 0);
      assert.equal(seek.data, 32 * 1024 * 1024);
      const write = await syscallAs(callerPid, SyscallNo.SYS_WRITE, opened.data, 'x');
      assert.equal(write.code, -1);
      assert.match(write.error, /EFBIG/);
      assert.equal(globalVFS.readFile(path, 'root'), 'keep');
      const current = await syscallAs(callerPid, SyscallNo.SYS_LSEEK, opened.data, 0, 1);
      assert.equal(current.data, 32 * 1024 * 1024, 'failed write must not advance the descriptor offset');
    } finally {
      await syscallAs(callerPid, SyscallNo.SYS_CLOSE, opened.data);
      globalVFS.remove(path, false, 'root');
    }
  });

  await report('open file descriptors are bounded per process and close restores capacity', async () => {
    const openedFds = [];
    try {
      for (let index = 0; index < 253; index++) {
        const opened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, '/dev/null', 'r');
        assert.equal(opened.code, 0, opened.error);
        openedFds.push(opened.data);
      }
      const overflow = await syscallAs(callerPid, SyscallNo.SYS_OPEN, '/dev/null', 'r');
      assert.equal(overflow.code, -1);
      assert.match(overflow.error, /EMFILE: process open-file limit \(256\) reached/);
    } finally {
      for (const fd of openedFds) {
        const closed = await syscallAs(callerPid, SyscallNo.SYS_CLOSE, fd);
        assert.equal(closed.code, 0, closed.error);
      }
    }
    const reopened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, '/dev/null', 'r');
    assert.equal(reopened.code, 0, reopened.error);
    assert.equal((await syscallAs(callerPid, SyscallNo.SYS_CLOSE, reopened.data)).code, 0);
  });

  await report('write-only append preserves unread existing content', async () => {
    const path = `/home/hello/tests/.posix-write-${Date.now()}`;
    assert.equal(globalVFS.writeFile(path, 'original', 'hello'), true);
    assert.equal(globalVFS.chmod(path, '200', false, 'hello'), true);
    const opened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, path, 'a');
    assert.equal(opened.code, 0, opened.error);
    try {
      const written = await syscallAs(callerPid, SyscallNo.SYS_WRITE, opened.data, '+append');
      assert.equal(written.code, 0, written.error);
      assert.equal(globalVFS.readFile(path, 'root'), 'original+append');
    } finally {
      await syscallAs(callerPid, SyscallNo.SYS_CLOSE, opened.data);
      globalVFS.remove(path, false, 'root');
    }
  });

  await report('negative lseek fails without silently clamping the descriptor offset', async () => {
    const path = `/home/hello/tests/.posix-seek-${Date.now()}`;
    assert.equal(globalVFS.writeFile(path, 'seek-data', 'hello'), true);
    const opened = await syscallAs(callerPid, SyscallNo.SYS_OPEN, path, 'r');
    assert.equal(opened.code, 0, opened.error);
    try {
      const seek = await syscallAs(callerPid, SyscallNo.SYS_LSEEK, opened.data, -1, 0);
      assert.equal(seek.code, -1);
      assert.match(seek.error, /EINVAL/);
      const read = await syscallAs(callerPid, SyscallNo.SYS_READ, opened.data, 4);
      assert.equal(read.data, 'seek');
    } finally {
      await syscallAs(callerPid, SyscallNo.SYS_CLOSE, opened.data);
      globalVFS.remove(path, false, 'root');
    }
  });

  await report('SYS_OPEN numeric modes match VFS capability checks and reject object coercion', async () => {
    const pid = 8_000_031;
    const path = `/home/hello/tests/.posix-open-mode-${Date.now()}`;
    assert.equal(globalVFS.writeFile(path, 'original', 'hello'), true);
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'open-mode-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', path);
    try {
      const opened = await syscallAs(pid, SyscallNo.SYS_OPEN, path, 1);
      assert.equal(opened.code, 0, opened.error);
      assert.equal(globalVFS.readFile(path, 'root'), '');
      await syscallAs(pid, SyscallNo.SYS_CLOSE, opened.data);

      let coercionRan = false;
      const invalid = await syscallAs(pid, SyscallNo.SYS_OPEN, path, {
        toJSON() { coercionRan = true; return 'w'; },
      });
      assert.equal(invalid.code, -1);
      assert.match(invalid.error, /EINVAL: Invalid open mode/);
      assert.equal(coercionRan, false);
      assert.equal(globalVFS.readFile(path, 'root'), '');

      const revoked = Proxy.revocable([], {});
      revoked.revoke();
      const malformed = await syscallAs(callerPid, SyscallNo.SYS_WAITPID, revoked.proxy);
      assert.equal(malformed.code, -1);
      assert.match(malformed.error, /revoked|EINVAL/i);

      const revokedNumber = Proxy.revocable({}, {});
      revokedNumber.revoke();
      const invalidSyscall = await syscallAs(callerPid, revokedNumber.proxy);
      assert.equal(invalidSyscall.code, -1);
      assert.match(invalidSyscall.error, /EINVAL: invalid syscall number/);

      let pidCoercionRan = false;
      const invalidPid = await syscallAs(callerPid, SyscallNo.SYS_KILL, {
        [Symbol.toPrimitive]() { pidCoercionRan = true; throw new Error('must not coerce PID'); },
      });
      assert.equal(invalidPid.code, -1);
      assert.match(invalidPid.error, /EPERM/);
      assert.equal(pidCoercionRan, false);
    } finally {
      globalTaskScheduler.terminateProcess(pid);
      globalVFS.remove(path, false, 'root');
    }
  });
  await report('strace callbacks are PID-scoped and cannot alter syscall results', async () => {
    const otherPid = 8_000_123;
    globalTaskScheduler.createProcess({
      pid: otherPid, ppid: callerPid, name: 'tracer-isolation-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    const entries = [];
    setSyscallTracer(callerPid, (entry) => entries.push(entry));
    try {
      assert.equal((await syscallAs(otherPid, SyscallNo.SYS_GETPID)).code, 0);
      assert.equal(entries.length, 0, 'another process syscall must not enter this process trace');
      assert.equal((await syscallAs(callerPid, SyscallNo.SYS_GETPID)).code, 0);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].callerPid, callerPid);
      const deniedEntries = [];
      setSyscallTracer(otherPid, (entry) => deniedEntries.push(entry));
      const deniedRead = await syscallAs(otherPid, SyscallNo.SYS_READ, '/etc/passwd');
      assert.notEqual(deniedRead.code, 0);
      assert.equal(deniedEntries.length, 1, 'denied syscall attempts must remain visible in strace');
      assert.match(deniedEntries[0].retvalStr, /EACCES/);
      assert.equal(globalTaskScheduler.terminateProcess(otherPid), true);
      globalTaskScheduler.createProcess({
        pid: otherPid, ppid: callerPid, name: 'tracer-pid-reuse-probe', user: 'hello', state: 'RUNNING',
        startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
      });
      assert.equal((await syscallAs(otherPid, SyscallNo.SYS_GETPID)).code, 0);
      assert.equal(deniedEntries.length, 1, 'process exit must remove its tracer before PID reuse');
      setSyscallTracer(callerPid, () => { throw new Error('tracer failure'); });
      const unaffected = await syscallAs(callerPid, SyscallNo.SYS_GETPID);
      assert.equal(unaffected.code, 0, 'tracer exceptions must not fail the syscall');
    } finally {
      setSyscallTracer(callerPid, null);
      setSyscallTracer(otherPid, null);
      globalTaskScheduler.terminateProcess(otherPid);
    }
  });

  await report('process without capabilities is denied VFS reads', async () => {
    const pid = 8_000_001;
    globalTaskScheduler.createProcess({
      pid, ppid: callerPid, name: 'no-capability-probe', user: 'hello', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    assert.deepEqual(globalCapabilityManager.getCapabilities(pid), []);
    try {
      const result = await syscallAs(pid, SyscallNo.SYS_READ, '/home/hello/welcome.txt');
      assert.equal(result.code, -1);
      assert.match(result.error, /EACCES/);
    } finally {
      globalTaskScheduler.terminateProcess(pid);
    }
  });

  await report('capability management requires CAP_SYS_ADMIN and scopes grants', async () => {
    const { capCommands } = await server.ssrLoadModule('/src/core/commands/capCommands.ts');
    const capGrant = capCommands.find((command) => command.name === 'cap-grant');
    const capRevoke = capCommands.find((command) => command.name === 'cap-revoke');
    const capList = capCommands.find((command) => command.name === 'cap-list');
    assert.ok(capGrant && capRevoke && capList);
    const targetPid = 8_000_021;
    const adminPid = 8_000_022;
    const pcb = (pid, name) => ({
      pid, ppid: callerPid, name, user: 'hello', state: 'RUNNING', startTime: new Date(),
      vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalTaskScheduler.createProcess(pcb(targetPid, 'cap-target-probe'));
    globalTaskScheduler.createProcess(pcb(adminPid, 'cap-admin-probe'));
    globalCapabilityManager.grantCapability(adminPid, 'CAP_SYS_ADMIN');
    const call = (command, args, pid) => command.execute({ args, callerPid: pid });
    try {
      assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_SYS_ADMIN'), false);
      const deniedGrant = await call(capGrant, [String(targetPid), 'CAP_VFS_READ', '/'], callerPid);
      assert.equal(deniedGrant.exitCode, 1);
      assert.match(deniedGrant.stderr, /CAP_SYS_ADMIN/);
      assert.deepEqual(globalCapabilityManager.getCapabilityTokens(targetPid), []);

      const deniedList = await call(capList, [String(targetPid)], callerPid);
      assert.equal(deniedList.exitCode, 1);
      const staleTargetGrant = await call(capGrant, ['8000099', 'CAP_SYS_ADMIN', '*'], adminPid);
      assert.equal(staleTargetGrant.exitCode, 1);
      assert.match(staleTargetGrant.stderr, /target PID .* is not running/);
      assert.deepEqual(globalCapabilityManager.getCapabilityTokens(8_000_099), []);
      assert.equal(globalCapabilityManager.grantCapability(targetPid, 'CAP_SYS_ADMIN', '/home/hello'), false);
      const scopedAdminGrant = await call(capGrant, [String(targetPid), 'CAP_SYS_ADMIN', '/home/hello'], adminPid);
      assert.equal(scopedAdminGrant.exitCode, 1);
      assert.equal(globalCapabilityManager.hasCapability(targetPid, 'CAP_SYS_ADMIN'), false);
      assert.equal(globalCapabilityManager.grantCapability(targetPid, 'CAP_SYS_ADMIN', '*'), true);
      assert.equal(globalCapabilityManager.hasCapability(targetPid, 'CAP_SYS_ADMIN'), true);
      globalCapabilityManager.clearCapabilities(targetPid);
      const granted = await call(capGrant, [String(targetPid), 'CAP_VFS_READ', '/home/hello/project'], adminPid);
      assert.equal(granted.exitCode, 0, granted.stderr);
      assert.equal(globalCapabilityManager.hasCapability(targetPid, 'CAP_VFS_READ', '/home/hello/project/file'), true);
      assert.equal(globalCapabilityManager.hasCapability(targetPid, 'CAP_VFS_READ', '/etc/passwd'), false);
      assert.equal((await call(capList, [String(targetPid)], adminPid)).exitCode, 0);
      assert.equal((await call(capRevoke, [String(targetPid), 'CAP_VFS_READ'], callerPid)).exitCode, 1);
      assert.equal((await call(capRevoke, [String(targetPid), 'CAP_VFS_READ'], adminPid)).exitCode, 0);
      assert.equal(globalCapabilityManager.hasCapability(targetPid, 'CAP_VFS_READ'), false);
    } finally {
      globalTaskScheduler.terminateProcess(targetPid);
      globalTaskScheduler.terminateProcess(adminPid);
    }
  });

  await report('system snapshots require CAP_SYS_ADMIN and report storage failures', async () => {
    const [{ sysCommands }, { globalSnapshotEngine }] = await Promise.all([
      server.ssrLoadModule('/src/core/commands/sysCommands.ts'),
      server.ssrLoadModule('/src/core/snapshotEngine.ts'),
    ]);
    const snapshot = sysCommands.find((command) => command.name === 'snapshot');
    assert.ok(snapshot);
    const name = `verify-denied-${Date.now()}`;
    const result = snapshot.execute({
      args: ['save', name], callerPid, env: { USER: 'hello' },
      vfs: globalVFS, processManager: globalProcessManager,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /CAP_SYS_ADMIN/);
    assert.equal(globalSnapshotEngine.getSnapshots(callerPid).some((entry) => entry.name === name), false);
    assert.equal(globalSnapshotEngine.saveSnapshot(name, callerPid).success, false);
    assert.match(globalSnapshotEngine.restoreSnapshot(name, callerPid).message, /CAP_SYS_ADMIN/);
    assert.equal(globalSnapshotEngine.deleteSnapshot(name, callerPid), false);

    const adminPid = 8_000_031;
    globalTaskScheduler.createProcess({
      pid: adminPid, ppid: callerPid, name: 'snapshot-storage-probe', user: 'root', state: 'RUNNING',
      startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/root',
    });
    globalCapabilityManager.grantCapability(adminPid, 'CAP_SYS_ADMIN');
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const failedName = `verify-storage-${Date.now()}`;
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } },
      });
      const failedSave = snapshot.execute({ args: ['save', failedName], callerPid: adminPid });
      assert.equal(failedSave.exitCode, 1);
      assert.match(failedSave.stderr, /not saved/);
      assert.equal(globalSnapshotEngine.getSnapshots(adminPid).some((entry) => entry.name === failedName), false);

      const storageValues = new Map();
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: { getItem: (key) => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) },
      });
      const restoreName = `verify-restore-${Date.now()}`;
      const probePath = '/home/hello/tests/snapshot-restore-probe.txt';
      assert.equal(globalVFS.writeFile(probePath, 'before restore', 'hello'), true);
      assert.equal(globalVFS.chmod(probePath, '600', false, 'root'), true);
      const saved = snapshot.execute({ args: ['save', restoreName], callerPid: adminPid });
      assert.equal(saved.exitCode, 0, saved.stderr);
      assert.equal(globalVFS.writeFile(probePath, 'after restore', 'root'), true);
      assert.equal(globalVFS.chmod(probePath, '644', false, 'root'), true);
      const restored = snapshot.execute({ args: ['restore', restoreName], callerPid: adminPid });
      assert.equal(restored.exitCode, 0, restored.stderr);
      assert.equal(globalVFS.readFile(probePath, 'root'), 'before restore');
      assert.equal(globalVFS.getNodeByPath(probePath, 'root')?.permissions, 'rw-------');
      assert.equal(globalSnapshotEngine.deleteSnapshot(restoreName, adminPid), true);
      assert.equal(globalVFS.remove(probePath, false, 'root'), true);
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else delete globalThis.localStorage;
      globalTaskScheduler.terminateProcess(adminPid);
    }
  });

  await report('VFS image imports preflight file limits and preserve symbolic links', async () => {
    const [{ globalVFSImageEngine }, { VirtualFileSystem }] = await Promise.all([
      server.ssrLoadModule('/src/core/vfsImageEngine.ts'),
      server.ssrLoadModule('/src/core/vfs.ts'),
    ]);
    const originalLimit = VirtualFileSystem.MAX_FILE_BYTES;
    const base = `/home/hello/tests/.vfs-image-${Date.now()}`;
    assert.equal(globalVFS.mkdir(base, true), true);
    try {
      VirtualFileSystem.MAX_FILE_BYTES = 4;
      const rejected = globalVFSImageEngine.importImage(JSON.stringify({
        header: { magic: 'EARENDEL_VFS_V1' },
        nodes: {
          [`${base}/link`]: { type: 'symlink', symlinkTarget: 'target' },
          [`${base}/too-large`]: { type: 'file', content: '12345' },
        },
      }));
      assert.equal(rejected.success, false);
      assert.equal(globalVFS.exists(`${base}/link`, 'root'), false, 'preflight must prevent partial import');
      assert.equal(globalVFS.exists(`${base}/too-large`, 'root'), false);

      const imported = globalVFSImageEngine.importImage(JSON.stringify({
        header: { magic: 'EARENDEL_VFS_V1' },
        nodes: { [`${base}/link`]: { type: 'symlink', symlinkTarget: 'target' } },
      }));
      assert.equal(imported.success, true, imported.message);
      assert.equal(globalVFS.getNodeByPath(`${base}/link`, 'root')?.symlinkTarget, 'target');
    } finally {
      VirtualFileSystem.MAX_FILE_BYTES = originalLimit;
      globalVFS.remove(base, true, 'root');
    }
  });

  await report('kill signal zero probes permissions without delivery and invalid signals are rejected', async () => {
    const childPid = await forkChild('invalid-signal-probe');
    try {
      const child = globalTaskScheduler.getProcess(childPid);
      const signalsBefore = [...(child?.pendingSignals || [])];
      const probe = await syscallAs(callerPid, SyscallNo.SYS_KILL, childPid, 0);
      assert.equal(probe.code, 0, probe.error);
      assert.equal(globalTaskScheduler.getProcess(childPid)?.state, 'RUNNING');
      assert.deepEqual(globalTaskScheduler.getProcess(childPid)?.pendingSignals || [], signalsBefore);
      const result = await syscallAs(callerPid, SyscallNo.SYS_KILL, childPid, 64);
      assert.equal(result.code, -1);
      assert.match(result.error, /EINVAL/);
      assert.equal(globalTaskScheduler.getProcess(childPid)?.state, 'RUNNING');
    } finally {
      await exitAndWait(childPid, 0);
    }
  });

  await report('orphan adoption and init auto-reap do not retain zombie children', () => {
    const parentPid = 8_000_011;
    const orphanPid = 8_000_012;
    const pcb = (pid, ppid, name) => ({
      pid, ppid, name, user: 'hello', state: 'RUNNING', startTime: new Date(),
      vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/home/hello',
    });
    globalTaskScheduler.createProcess(pcb(parentPid, callerPid, 'orphan-parent-probe'));
    globalTaskScheduler.createProcess(pcb(orphanPid, parentPid, 'orphan-child-probe'));
    assert.equal(globalTaskScheduler.exitProcess(parentPid, 0), true);
    assert.equal(globalTaskScheduler.getProcess(orphanPid)?.ppid, 1);
    assert.equal(globalTaskScheduler.exitProcess(orphanPid, 0), true);
    assert.equal(globalTaskScheduler.getProcess(orphanPid), null);
    globalTaskScheduler.reapProcess(parentPid);
  });

  await report('process table exhaustion returns EAGAIN and remains recoverable', async () => {
    const oversizedName = await syscallAs(callerPid, SyscallNo.SYS_FORK, 'x'.repeat(129), '/home/hello');
    assert.equal(oversizedName.code, -1);
    assert.match(oversizedName.error, /process name must be 1-128 characters/);
    const invalidCwd = await syscallAs(callerPid, SyscallNo.SYS_FORK, 'invalid-cwd-probe', 'relative/path');
    assert.equal(invalidCwd.code, -1);
    assert.match(invalidCwd.error, /working directory must be an absolute path/);

    const allocatedPids = [];
    let nextPid = 9_000_000;
    try {
      while (globalTaskScheduler.canCreateProcess()) {
        const pid = nextPid++;
        globalTaskScheduler.createProcess({
          pid, ppid: 1, name: 'process-table-capacity-probe', user: 'root', state: 'RUNNING',
          startTime: new Date(), vszKB: 1, rssKB: 1, cpuUsagePercent: 0, cwd: '/',
        });
        allocatedPids.push(pid);
      }
      assert.equal(globalTaskScheduler.canCreateProcess(), false);
      assert.equal(globalTaskScheduler.getAllProcesses().length, globalTaskScheduler.constructor.MAX_PROCESSES);
      const fork = await syscallAs(callerPid, SyscallNo.SYS_FORK, 'process-table-overflow', '/home/hello');
      assert.equal(fork.code, -1);
      assert.match(fork.error, /EAGAIN: process table is full/);
    } finally {
      for (const pid of allocatedPids) globalTaskScheduler.terminateProcess(pid);
    }
    assert.equal(globalTaskScheduler.canCreateProcess(), true);
    assert.equal(globalTaskScheduler.getProcess(9_000_000), null);
  });
} catch (error) {
  failures++;
  console.error(error?.stack || error);
} finally {
  try {
    const { globalCronEngine } = await server.ssrLoadModule('/src/core/cronEngine.ts');
    globalCronEngine.stopDaemon();
  } catch {}
  await server.close();
}

console.log(`POSIX verification: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failed checks)`);
process.exit(failures === 0 ? 0 : 1);
