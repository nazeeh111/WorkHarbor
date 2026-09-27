#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformKeys = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN'];

export function localCommand(args, inherited = process.env, cwd = root, platform = process.platform) {
  if (platform === 'win32') throw new Error('This local launcher supports macOS and Linux. Windows launcher support is not yet available.');
  let gitEntry;
  try { gitEntry = lstatSync(path.join(cwd, '.git')); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (gitEntry && !gitEntry.isDirectory()) throw new Error('Use a regular clone or source archive for this launcher. Linked worktrees can load separate instance configuration.');
  const action = args[0] ?? 'start';
  if (!['start', 'stop'].includes(action)) throw new Error('Use start or stop.');
  let stateDir = path.join(cwd, '.workharbor');
  let port = '3180';
  let schedule = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--schedule' && action === 'start') { schedule = true; continue; }
    if (arg !== '--state-dir' && !(arg === '--port' && action === 'start')) throw new Error(`Unknown option for ${action}: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
    if (arg === '--state-dir') stateDir = path.resolve(cwd, value);
    else {
      if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
      port = String(Number(value));
    }
  }
  const env = Object.fromEntries(platformKeys.filter(k => inherited[k] !== undefined).map(k => [k, inherited[k]]));
  Object.assign(env, {
    PAPERCLIP_HOME: stateDir,
    PAPERCLIP_INSTANCE_ID: 'workharbor',
    PAPERCLIP_CONFIG: path.join(stateDir, 'instances', 'workharbor', 'config.json'),
    PAPERCLIP_CONTEXT: path.join(stateDir, 'context.json'),
    PAPERCLIP_DISABLE_CWD_ENV_FILE: 'true',
    PAPERCLIP_TAILNET_BIND_HOST: '127.0.0.1',
    PAPERCLIP_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    PAPERCLIP_ANNOUNCEMENTS_ENABLED: 'false',
    HEARTBEAT_SCHEDULER_ENABLED: String(schedule),
    HOST: '127.0.0.1',
    PORT: port,
  });
  return {
    command: 'pnpm',
    args: [action === 'start' ? 'dev:once' : 'dev:stop', '--data-dir', stateDir, ...(action === 'start' ? ['--bind', 'loopback'] : [])],
    env,
    cwd,
  };
}

export function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('WorkHarbor local workspace (macOS/Linux, regular clone or source archive)\n\nnode scripts/workharbor-local.mjs start [--state-dir PATH] [--port 3180] [--schedule]\nnode scripts/workharbor-local.mjs stop [--state-dir PATH]\n\nState defaults to .workharbor in the repository. Start binds to loopback, disables telemetry and announcements, and leaves scheduled agent runs off unless --schedule is supplied. Manual task actions can still run agents. Provider and database environment variables are not inherited; configure this isolated instance explicitly. Stop targets all development services for this checkout in the selected state directory.');
    return;
  }
  let spec;
  try { spec = localCommand(args); }
  catch (err) { console.error(`WorkHarbor: ${err.message}`); process.exitCode = 2; return; }
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: 'inherit', shell: false });
  const onInt = () => child.kill('SIGINT');
  const onTerm = () => child.kill('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  const detach = () => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); };
  child.once('error', () => {
    detach();
    console.error('WorkHarbor could not start pnpm. Install the pinned package manager and dependencies, then retry.');
    process.exitCode = 2;
  });
  child.once('exit', (code, signal) => { detach(); process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
