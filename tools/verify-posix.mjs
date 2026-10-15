import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  const [{ BatsTestEngine }, { globalVFS }, { globalProcessManager }, { globalTaskScheduler }, { globalCapabilityManager }, { globalVMPageTable }, { SyscallNo }, { syscallAs }, { globalCronEngine }, , , { findSuiteCommands }] = await Promise.all([
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
  const { globalJsEngine } = await server.ssrLoadModule('/src/core/jsRuntime.ts');
  const { runEafInWorker, EAF_WORKER_SOURCE } = await server.ssrLoadModule('/src/core/eafWorker.ts');

  const callerPid = 24;
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
  await report('EAF Worker bootstrap parses and strips direct browser capabilities', async () => {
    assert.doesNotThrow(() => new Function(EAF_WORKER_SOURCE));
    for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'caches', 'importScripts', 'Worker', 'navigator', 'postMessage', 'onmessage', 'BroadcastChannel']) {
      assert.ok(EAF_WORKER_SOURCE.includes(`'${api}'`), `missing blocked API: ${api}`);
    }
    assert.match(EAF_WORKER_SOURCE, /if \(!event\.isTrusted\) return/);
    assert.match(EAF_WORKER_SOURCE, /channelToken/);
    assert.match(EAF_WORKER_SOURCE, /Worker platform could not disable APIs/);
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
  const [{ HarnessEngine }, { globalIPCBus }, { globalAgentMemoryManager }, { globalWaylandDaemon }] = await Promise.all([
    server.ssrLoadModule('/src/core/harnessEngine.ts'),
    server.ssrLoadModule('/src/kernel/ipcBus.ts'),
    server.ssrLoadModule('/src/core/memoryEngine.ts'),
    server.ssrLoadModule('/src/kernel/services/waylandd.ts'),
  ]);
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
      for (let attempt = 0; attempt < 20 && !getPidObservationStarted; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.equal(getPidObservationStarted, true, 'queued observation was not dispatched asynchronously');
    } finally {
      finishObservation?.(false);
      globalKernelAgentManager.setAgentStatus(agentId, false);
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
    const other = globalProcessManager.addJob('wayland-isolation-check', callerPid);
    try {
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
  await report('shell command execution uses the constrained VFS view', async () => {
    const shell = new ShellEngine(globalVFS, globalProcessManager);
    const echo = await shell.execute('echo constrained-vfs');
    assert.equal(echo.stdout.trim(), 'constrained-vfs');
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
    const original = globalVFS.getNodeByPath('/home/hello')?.children?.size;
    directorySnapshot.children.clear();
    assert.equal(globalVFS.getNodeByPath('/home/hello')?.children?.size, original);
  });
  await report('interactive PID has scoped user defaults and VFS honors authenticated process identity', async () => {
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_READ', '/home/hello/file'), true);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_READ', '/root/.ssh/id_rsa'), false);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_WRITE', '/tmp/output'), true);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_VFS_WRITE', '/etc/hosts'), false);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_NET_ADMIN'), false);
    assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_DEVICE_IO'), false);
    const shell = new ShellEngine(globalVFS, globalProcessManager);
    const endpoint = globalIPCBus.getProcessEndpoint(callerPid);
    const userRead = await globalIPCBus.sendIPC(endpoint, 'vfsd', 'SYS_READ', { path: '/etc/shadow' });
    assert.equal(userRead.content, null);
    try {
      shell.setAuthenticatedUser('root');
      assert.equal(globalCapabilityManager.hasCapability(callerPid, 'CAP_SYS_ADMIN'), true);
      assert.equal(globalTaskScheduler.getProcess(callerPid)?.user, 'root');
      const rootRead = await globalIPCBus.sendIPC(endpoint, 'vfsd', 'SYS_READ', { path: '/etc/shadow' });
      assert.match(rootRead.content, /earendel_hash/);
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
  const forkChild = async (name) => {
    const result = await syscallAs(callerPid, SyscallNo.SYS_FORK, name, '/home/hello');
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
    assert.equal(globalVFS.writeFile('/etc/mcp.conf', JSON.stringify({
      mcpServers: { verification: { url: 'https://mcp.invalid/rpc' } },
    }), 'root'), true);
    globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Unavailable' });
    try {
      const manager = new McpClientManager();
      await assert.rejects(manager.callTool('verification', 'probe', {}), /MCP request.*HTTP Error 503/);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalConfig === null) globalVFS.remove('/etc/mcp.conf', false, 'root');
      else globalVFS.writeFile('/etc/mcp.conf', originalConfig, 'root');
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

  await report('Skill grants require caller approval and output is capped before persistence', async () => {
    const path = '/home/hello/tests/.skill-large-output';
    assert.equal(globalVFS.writeFile(path, 'x'.repeat(70_000), 'hello'), true);
    const originalSendIPC = globalIPCBus.sendIPC.bind(globalIPCBus);
    const originalWriteScratchpad = globalAgentMemoryManager.writeScratchpad.bind(globalAgentMemoryManager);
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
      const unapproved = await engine.executeSkill(skillContent, execCtx);
      assert.equal(unapproved.exitCode, 1);
      assert.match(unapproved.stdout, /not explicitly permitted by skill tools\.system/);

      const fileGrant = { vfs_read: [path], system_tools: ['cat'] };
      responsePath = '/etc/passwd';
      const outsideScope = await engine.executeSkill(skillContent, execCtx, undefined, undefined, fileGrant);
      assert.equal(outsideScope.exitCode, 1);
      assert.match(outsideScope.stdout, /outside permissions\.vfs_read/);

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
    } finally {
      globalIPCBus.sendIPC = originalSendIPC;
      globalAgentMemoryManager.writeScratchpad = originalWriteScratchpad;
      globalVFS.remove(path, false, 'root');
      globalVFS.remove('/home/hello/tests/.skill-permission-probe.md', false, 'root');
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

  await report('unsupported kill signal is rejected before changing child state', async () => {
    const childPid = await forkChild('invalid-signal-probe');
    try {
      const result = await syscallAs(callerPid, SyscallNo.SYS_KILL, childPid, 0);
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
