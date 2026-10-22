import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type CodexQuotaClientOptions = {
  executable: string;
  onSnapshot: (raw: unknown, reconnect: boolean) => void;
  onUnavailable: (reason: string) => void;
  spawnProcess?: (exe: string, args: string[]) => ChildProcessWithoutNullStreams;
  reconnectDelayMs?: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

export function createCodexQuotaClient(options: CodexQuotaClientOptions) {
  const spawnProcess = options.spawnProcess ?? ((exe: string, args: string[]) =>
    spawn(exe, args, { shell: false, windowsHide: true, stdio: 'pipe' }));
  const pending = new Map<number, Pending>();
  let child: ChildProcessWithoutNullStreams | null = null;
  let nextId = 1;
  let stopping = false;
  let hasConnected = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let connecting: Promise<void> | null = null;
  let stdoutBuffer = '';
  let retryAttempt = 0;

  function rejectPending(error: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  function takeChild(): ChildProcessWithoutNullStreams | null {
    const active = child;
    child = null;
    return active;
  }

  function request(method: string, params?: unknown): Promise<unknown> {
    if (!child) return Promise.reject(new Error('Codex App Server 未连接'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex App Server 请求超时: ${method}`));
      }, 30_000);
      pending.set(id, { resolve, reject, timeout });
      child!.stdin.write(`${JSON.stringify({ method, id, ...(params === undefined ? {} : { params }) })}\n`, error => {
        if (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        }
      });
    });
  }

  function handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      clearTimeout(waiting.timeout);
      if (message.error) waiting.reject(new Error('Codex App Server 请求失败'));
      else waiting.resolve(message.result);
      return;
    }
    if (message.method === 'account/rateLimits/updated' && !stopping) {
      void refresh().catch(() => {});
    }
  }

  function handleChunk(chunk: Buffer): void {
    stdoutBuffer += chunk.toString('utf8');
    let end: number;
    while ((end = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, end).trim();
      stdoutBuffer = stdoutBuffer.slice(end + 1);
      if (line) handleLine(line);
    }
  }

  function scheduleReconnect(): void {
    if (stopping || reconnectTimer) return;
    const baseDelay = Math.max(1, options.reconnectDelayMs ?? 5_000);
    const delay = Math.min(baseDelay * 2 ** Math.min(retryAttempt, 4), 30_000);
    retryAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch(() => scheduleReconnect());
    }, delay);
  }

  function handleExit(exited: ChildProcessWithoutNullStreams): void {
    if (child !== exited) return;
    child = null;
    rejectPending(new Error('Codex App Server 已断开'));
    if (!stopping) {
      options.onUnavailable('Codex App Server 已断开');
      scheduleReconnect();
    }
  }

  async function connect(): Promise<void> {
    if (connecting) return connecting;
    if (child) return;
    connecting = (async () => {
      stdoutBuffer = '';
      const processHandle = spawnProcess(options.executable, ['app-server', '--listen', 'stdio://']);
      child = processHandle;
      processHandle.stdout.on('data', handleChunk);
      processHandle.on('exit', () => handleExit(processHandle));
      processHandle.on('error', () => handleExit(processHandle));
      await request('initialize', { clientInfo: { name: 'codex_quota_pet', title: 'Codex Quota Pet', version: '0.1.0' } });
      if (!child) throw new Error('Codex App Server 已断开');
      child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
      await request('account/read', { refreshToken: false });
      await refresh();
      hasConnected = true;
      retryAttempt = 0;
    })();
    try {
      await connecting;
    } catch (error) {
      const failed = takeChild();
      if (failed) {
        rejectPending(error instanceof Error ? error : new Error('Codex App Server 连接失败'));
        failed.kill();
      }
      if (!stopping && !reconnectTimer) {
        options.onUnavailable(error instanceof Error ? error.message : 'Codex App Server 连接失败');
        scheduleReconnect();
      }
      throw error;
    } finally {
      connecting = null;
    }
  }

  async function refresh(): Promise<void> {
    const result = await request('account/rateLimits/read');
    options.onSnapshot(result, hasConnected);
  }

  return {
    async start(): Promise<void> {
      stopping = false;
      await connect();
    },
    refresh,
    async stop(): Promise<void> {
      stopping = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      rejectPending(new Error('Codex App Server 已停止'));
      const processHandle = child;
      child = null;
      processHandle?.kill();
    },
  };
}
