import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

type ResolveOptions = {
  searchPath?: () => Promise<string[]>;
  installRoot?: string;
};

function fromPath(): Promise<string[]> {
  return new Promise(resolve => {
    execFile('where.exe', ['codex.exe'], { windowsHide: true }, (error, stdout) => {
      resolve(error ? [] : stdout.split(/\r?\n/).map(path => path.trim()).filter(Boolean));
    });
  });
}

async function desktopCandidates(root: string): Promise<string[]> {
  const bin = join(root, 'OpenAI', 'Codex', 'bin');
  try {
    const versions = await readdir(bin, { withFileTypes: true });
    return versions.filter(entry => entry.isDirectory()).map(entry => join(bin, entry.name, 'codex.exe')).reverse();
  } catch {
    return [];
  }
}

export async function resolveCodexExecutable(
  candidates: string[] = [],
  options: ResolveOptions = {},
): Promise<string> {
  const searchPath = options.searchPath ?? fromPath;
  const installRoot = options.installRoot ?? process.env.LOCALAPPDATA ?? '';
  const paths = [...candidates, ...await searchPath(), ...await desktopCandidates(installRoot)];
  for (const path of paths) {
    if (!path.toLowerCase().endsWith('codex.exe')) continue;
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      // Try the next installed executable.
    }
  }
  throw new Error('未找到 Codex 可执行文件 codex.exe；请先安装 Codex Desktop。');
}
