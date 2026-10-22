import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveCodexExecutable } from '../src/main/codexExecutable';
import { createCodexQuotaClient } from '../src/main/codexQuotaClient';

class FakeServer extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  requests: Array<Record<string, unknown>> = [];
  private buffer = '';
  private handler: (request: Record<string, unknown>) => void;

  constructor(handler: (request: Record<string, unknown>) => void) {
    super();
    this.handler = handler;
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let end: number;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const request = JSON.parse(this.buffer.slice(0, end)) as Record<string, unknown>;
        this.buffer = this.buffer.slice(end + 1);
        this.requests.push(request);
        this.handler(request);
      }
    });
  }

  send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill(): boolean {
    this.emit('exit', 0, null);
    return true;
  }

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

const week = { usedPercent: 48, windowDurationMins: 10080, resetsAt: 1793082925 };

function respondingServer(onQuota?: (server: FakeServer, id: unknown, count: number) => void): FakeServer {
  let quotaCount = 0;
  const server = new FakeServer(request => {
    if (request.method === 'initialize') {
      const reply = `${JSON.stringify({ id: request.id, result: { userAgent: 'test' } })}\n`;
      server.stdout.write(reply.slice(0, 9));
      server.stdout.write(reply.slice(9));
    } else if (request.method === 'account/read') {
      server.send({ id: request.id, result: { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true } });
    } else if (request.method === 'account/rateLimits/read') {
      quotaCount += 1;
      if (onQuota) onQuota(server, request.id, quotaCount);
      else server.send({ id: request.id, result: { rateLimits: { limitId: 'codex', primary: week, secondary: null } } });
    }
  });
  return server;
}

it('handshakes before reading quota and handles split replies and a change notification', async () => {
  const snapshots: unknown[] = [];
  const server = respondingServer((fake, id, count) => {
    fake.send({ id, result: { rateLimits: { limitId: 'codex', primary: { ...week, usedPercent: 47 + count }, secondary: null } } });
    if (count === 1) queueMicrotask(() => fake.send({ method: 'account/rateLimits/updated', params: {} }));
  });
  const client = createCodexQuotaClient({
    executable: 'C:\\Program Files\\Codex\\codex.exe',
    spawnProcess: () => server.asChild(),
    onSnapshot: raw => snapshots.push(raw),
    onUnavailable: () => { throw new Error('unexpected unavailable'); },
  });
  await client.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(server.requests.map(request => request.method)).toEqual([
    'initialize', 'initialized', 'account/read', 'account/rateLimits/read', 'account/rateLimits/read',
  ]);
  expect(snapshots).toHaveLength(2);
  expect((snapshots[1] as { rateLimits: { primary: { usedPercent: number } } }).rateLimits.primary.usedPercent).toBe(49);
  await client.stop();
});

it('rejects a pending request on exit and reconnects without retaining stale results', async () => {
  let firstQuota = true;
  const first = respondingServer((fake, id) => {
    if (firstQuota) {
      firstQuota = false;
      fake.send({ id, result: { rateLimits: { limitId: 'codex', primary: week } } });
    }
  });
  const second = respondingServer();
  const servers = [first, second];
  const reconnectFlags: boolean[] = [];
  const unavailable: string[] = [];
  const client = createCodexQuotaClient({
    executable: 'codex.exe',
    spawnProcess: () => servers.shift()!.asChild(),
    onSnapshot: (_raw, reconnect) => reconnectFlags.push(reconnect),
    onUnavailable: reason => unavailable.push(reason),
    reconnectDelayMs: 1,
  });
  await client.start();
  const pending = client.refresh();
  first.emit('exit', 1, null);
  await expect(pending).rejects.toThrow();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(unavailable).toHaveLength(1);
  expect(reconnectFlags).toEqual([false, true]);
  await client.stop();
});

it('does not restart after an explicit stop', async () => {
  const server = respondingServer();
  let launches = 0;
  const client = createCodexQuotaClient({
    executable: 'codex.exe',
    spawnProcess: () => { launches += 1; return server.asChild(); },
    onSnapshot: () => {}, onUnavailable: () => {}, reconnectDelayMs: 1,
  });
  await client.start();
  await client.stop();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(launches).toBe(1);
});

it('allows a slow account read during Codex authentication startup', async () => {
  vi.useFakeTimers();
  const server = new FakeServer(request => {
    if (request.method === 'initialize') server.send({ id: request.id, result: {} });
    if (request.method === 'account/read') {
      setTimeout(() => server.send({ id: request.id, result: { account: { type: 'chatgpt' } } }), 11_000);
    }
    if (request.method === 'account/rateLimits/read') {
      server.send({ id: request.id, result: { rateLimits: { limitId: 'codex', primary: week } } });
    }
  });
  const client = createCodexQuotaClient({
    executable: 'codex.exe', spawnProcess: () => server.asChild(),
    onSnapshot: () => {}, onUnavailable: () => {},
  });
  try {
    const started = expect(client.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(11_000);
    await started;
  } finally {
    await client.stop();
    vi.useRealTimers();
  }
});

it('reconnects when an initial account request fails without a process exit', async () => {
  const first = new FakeServer(request => {
    if (request.method === 'initialize') first.send({ id: request.id, result: {} });
    if (request.method === 'account/read') first.send({ id: request.id, error: { code: 'temporarily_unavailable' } });
  });
  const second = respondingServer();
  const servers = [first, second];
  const snapshots: boolean[] = [];
  const client = createCodexQuotaClient({
    executable: 'codex.exe',
    spawnProcess: () => servers.shift()!.asChild(),
    onSnapshot: (_raw, reconnect) => snapshots.push(reconnect),
    onUnavailable: () => {}, reconnectDelayMs: 1,
  });
  await expect(client.start()).rejects.toThrow();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(snapshots).toEqual([false]);
  await client.stop();
});

const tempPaths: string[] = [];
afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

it('accepts an executable path containing spaces and reports a missing one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex pet '));
  tempPaths.push(root);
  const bin = join(root, 'OpenAI Codex');
  await mkdir(bin);
  const executable = join(bin, 'codex.exe');
  await writeFile(executable, '');
  expect(await resolveCodexExecutable([executable], { searchPath: async () => [], installRoot: root })).toBe(executable);
  await expect(resolveCodexExecutable([join(root, 'missing.exe')], { searchPath: async () => [], installRoot: join(root, 'empty') })).rejects.toThrow('Codex');
});
