// Records a real Codex CLI session routed through OpenCode Bridge, with chunk timings,
// for the README replay. Uses disposable state and CODEX_HOME; never touches ~/.codex.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopService } from '../../src/desktop/service.js';
import { ClientRegistry } from '../../src/clients/registry.js';
import { CodexClient, codexLifecycle } from '../../src/clients/codex.js';
import { GatewaySupervisor } from '../../src/runtime.js';
import { loadConfig } from '../../src/config.js';

const model = process.argv[2] || 'openrouter/nvidia/nemotron-3-super-120b-a12b:free';
const prompt = process.argv[3] || 'Run a shell command to count the lines in app.py, then tell me in one sentence what the file does.';
const root = await realpath(await mkdtemp(join(tmpdir(), 'bridge-codex-demo-')));
const state = join(root, 'state'), home = join(root, 'codex'), project = join(root, 'demo-app');
await mkdir(project, { recursive: true });
await writeFile(join(project, 'app.py'), 'from flask import Flask\n\napp = Flask(__name__)\n\n@app.get("/health")\ndef health():\n    return {"ok": True}\n\n@app.get("/hello/<name>")\ndef hello(name):\n    return {"message": f"Hello, {name}!"}\n\nif __name__ == "__main__":\n    app.run(port=8000)\n');
const service = new DesktopService(new ClientRegistry([new CodexClient(state, home, { ...codexLifecycle, terminal: async () => {} })]), new GatewaySupervisor(state), state);
try {
  await service.refresh();
  await service.launch('codex', { model }, 41490, false, { target: 'cli' });
  const started = Date.now(); const chunks: Array<[number, string]> = [];
  const command = `codex --profile opencode-bridge exec --skip-git-repo-check "${prompt}"`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('codex', ['--profile', 'opencode-bridge', 'exec', '--skip-git-repo-check', prompt], { cwd: project, env: { ...process.env, CODEX_HOME: home, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (data: Buffer) => chunks.push([Date.now() - started, data.toString('utf8')]);
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Codex did not finish in 4 minutes.')); }, 240_000);
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`codex exited ${code}`)); });
  });
  const hide = (value: string) => value.replaceAll(root, '~/demo');
  const text = hide(chunks.map(c => c[1]).join(''));
  await writeFile(new URL('../../docs/media/codex-session.json', import.meta.url), JSON.stringify({ recorded: new Date().toISOString(), model, command, durationMs: Date.now() - started, chunks: chunks.map(([t, s]) => [t, hide(s)]) }, null, 2));
  console.log(text);
} finally {
  const config = await loadConfig(state).catch(() => undefined);
  if (config) await new GatewaySupervisor(state).stop(config).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
