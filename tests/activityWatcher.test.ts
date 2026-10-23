import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createActivityWatcher } from '../src/main/activityWatcher';

const roots: string[] = [];

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'pet activity '));
  roots.push(home);
  const threads = new DatabaseSync(join(home, 'state_5.sqlite'));
  const turns = new DatabaseSync(join(home, 'thread_history_1.sqlite'));
  threads.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, originator TEXT)');
  turns.exec('CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT PRIMARY KEY, status TEXT, started_at INTEGER, completed_at INTEGER)');
  const addThread = (id: string, originator: string) => threads.prepare('INSERT INTO threads (id, originator) VALUES (?, ?)').run(id, originator);
  const addTurn = (id: string, threadId: string, status = 'inProgress', startedAt = Math.floor(Date.now() / 1000)) =>
    turns.prepare('INSERT INTO thread_turns (thread_id, turn_id, status, started_at, completed_at) VALUES (?, ?, ?, ?, NULL)').run(threadId, id, status, startedAt);
  return { home, threads, turns, addThread, addTurn };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('activity transition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('observes only active Desktop turns and stays working until both complete', async () => {
  const db = await fixture();
  db.addThread('a', 'Codex Desktop');
  db.addThread('b', 'Codex Desktop');
  db.addThread('cli', 'Codex CLI');
  db.addThread('ide', 'Codex IDE');
  db.addTurn('cli-turn', 'cli');
  db.addTurn('ide-turn', 'ide');
  db.addTurn('old', 'a', 'inProgress', Math.floor(Date.now() / 1000) - 48 * 3600);
  const changes: boolean[] = [];
  const watcher = createActivityWatcher({ codexHome: db.home, onChange: value => changes.push(value), isDesktopRunning: async () => true, scanIntervalMs: 20 });
  try {
    await watcher.start();
    expect(changes).toEqual([]);
    db.addTurn('one', 'a');
    await waitFor(() => changes.length === 1);
    expect(changes).toEqual([true]);
    db.addTurn('two', 'b');
    db.turns.prepare("UPDATE thread_turns SET status = 'completed', completed_at = ? WHERE turn_id = 'one'").run(Math.floor(Date.now() / 1000));
    await new Promise(resolve => setTimeout(resolve, 70));
    expect(changes).toEqual([true]);
    db.turns.prepare("UPDATE thread_turns SET status = 'completed', completed_at = ? WHERE turn_id = 'two'").run(Math.floor(Date.now() / 1000));
    await waitFor(() => changes.length === 2);
    expect(changes).toEqual([true, false]);
  } finally {
    await watcher.stop();
    db.threads.close();
    db.turns.close();
  }
});

it('returns to idle when Desktop exits and avoids duplicate transitions', async () => {
  const db = await fixture();
  db.addThread('desktop', 'Codex Desktop');
  db.addTurn('turn', 'desktop');
  let running = true;
  const changes: boolean[] = [];
  const watcher = createActivityWatcher({ codexHome: db.home, onChange: value => changes.push(value), isDesktopRunning: async () => running, scanIntervalMs: 20 });
  try {
    await watcher.start();
    expect(changes).toEqual([true]);
    running = false;
    await waitFor(() => changes.length === 2);
    await new Promise(resolve => setTimeout(resolve, 70));
    expect(changes).toEqual([true, false]);
  } finally {
    await watcher.stop();
    db.threads.close();
    db.turns.close();
  }
});

it('keeps the working image while the process check fails, then returns to idle on a confirmed exit', async () => {
  const db = await fixture();
  db.addThread('desktop', 'Codex Desktop');
  db.addTurn('turn', 'desktop');
  let processState: 'running' | 'error' | 'stopped' = 'running';
  const changes: boolean[] = [];
  const availability: boolean[] = [];
  const watcher = createActivityWatcher({
    codexHome: db.home,
    onChange: value => changes.push(value),
    onAvailabilityChange: value => availability.push(value),
    isDesktopRunning: async () => {
      if (processState === 'error') return null;
      return processState === 'running';
    },
    scanIntervalMs: 20,
  });
  try {
    await watcher.start();
    expect(changes).toEqual([true]);
    processState = 'error';
    await waitFor(() => availability.at(-1) === false);
    expect(changes).toEqual([true]);
    processState = 'stopped';
    await waitFor(() => changes.length === 2);
    expect(changes).toEqual([true, false]);
    expect(availability.at(-1)).toBe(true);
  } finally {
    await watcher.stop();
    db.threads.close();
    db.turns.close();
  }
});

it('keeps the working image while the task index is temporarily unreadable', async () => {
  const db = await fixture();
  db.addThread('desktop', 'Codex Desktop');
  db.addTurn('turn', 'desktop');
  const changes: boolean[] = [];
  const availability: boolean[] = [];
  const watcher = createActivityWatcher({
    codexHome: db.home,
    onChange: value => changes.push(value),
    onAvailabilityChange: value => availability.push(value),
    isDesktopRunning: async () => true,
    scanIntervalMs: 20,
  });
  try {
    await watcher.start();
    expect(changes).toEqual([true]);
    db.turns.exec('DROP TABLE thread_turns');
    await waitFor(() => availability.at(-1) === false);
    expect(changes).toEqual([true]);
  } finally {
    await watcher.stop();
    db.threads.close();
    db.turns.close();
  }
});

it('handles absent databases without publishing false activity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pet absent '));
  roots.push(home);
  const changes: boolean[] = [];
  const availability: boolean[] = [];
  const watcher = createActivityWatcher({ codexHome: home, onChange: value => changes.push(value), onAvailabilityChange: value => availability.push(value), isDesktopRunning: async () => true, scanIntervalMs: 20 });
  await watcher.start();
  expect(changes).toEqual([]);
  expect(availability).toEqual([false]);
  await watcher.stop();
});
