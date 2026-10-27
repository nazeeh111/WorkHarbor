import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { localCommand } from './workharbor-local.mjs';

test('isolates instance state and does not forward provider/database/cloud configuration', () => {
  const inherited = {PATH: '/bin', HOME: '/user', OPENAI_API_KEY: 'fixture', DATABASE_URL: 'fixture', PAPERCLIP_CONFIG: '/other/config', PAPERCLIP_HOME: '/other', PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: 'fixture', PAPERCLIP_AGENT_JWT_SECRET: 'ambient-fixture', BETTER_AUTH_SECRET: 'ambient-fallback'};
  const spec = localCommand([], inherited, '/repo');
  assert.equal(spec.env.HOME, '/user');
  assert.equal(spec.env.PAPERCLIP_HOME, path.resolve('/repo/.workharbor'));
  assert.equal(spec.env.PAPERCLIP_CONFIG, path.resolve('/repo/.workharbor/instances/workharbor/config.json'));
  for (const key of ['OPENAI_API_KEY','DATABASE_URL','PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN','PAPERCLIP_AGENT_JWT_SECRET','BETTER_AUTH_SECRET']) assert.equal(spec.env[key], undefined);
  assert.equal(inherited.PAPERCLIP_HOME, '/other');
  assert.equal(spec.env.PAPERCLIP_TELEMETRY_DISABLED, '1');
  assert.equal(spec.env.DO_NOT_TRACK, '1');
  assert.equal(spec.env.PAPERCLIP_ANNOUNCEMENTS_ENABLED, 'false');
  assert.equal(spec.env.HEARTBEAT_SCHEDULER_ENABLED, 'false');
  assert.equal(spec.env.HOST, '127.0.0.1');
  assert.equal(spec.env.PAPERCLIP_DISABLE_CWD_ENV_FILE, 'true');
  assert.equal(spec.env.PAPERCLIP_TAILNET_BIND_HOST, '127.0.0.1');
  assert.deepEqual(spec.args.slice(-2), ['--bind','loopback']);
});

test('start and stop resolve the same explicit state without a shell', () => {
  const args = ['--state-dir','state with spaces'];
  const start = localCommand(['start',...args,'--port','3188','--schedule'], {}, '/repo');
  const stop = localCommand(['stop',...args], {}, '/repo');
  assert.equal(start.env.PAPERCLIP_CONFIG, stop.env.PAPERCLIP_CONFIG);
  assert.equal(start.env.HEARTBEAT_SCHEDULER_ENABLED, 'true');
  assert.equal(start.env.PORT,'3188');
  assert.deepEqual(stop.args, ['dev:stop','--data-dir',path.resolve('/repo/state with spaces')]);
});

test('rejects malformed commands and option values', () => {
  for (const args of [['erase'],['start','--state-dir'],['start','--port','0'],['start','--port','3180.5'],['start','--port','65536'],['start','--port','3e3'],['stop','--schedule'],['stop','--port','3180'],['start','--unknown']]) assert.throws(() => localCommand(args, {}, '/repo'));
});

test('refuses unsupported Windows and linked-worktree startup before spawning', () => {
  assert.throws(() => localCommand([], {}, '/repo', 'win32'), /Windows launcher/);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'workharbor-launcher-'));
  try {
    writeFileSync(path.join(dir,'.git'), 'gitdir: /unused/metadata\n');
    assert.throws(() => localCommand([], {}, dir), /Linked worktrees/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('bootstraps the selected instance before starting and leaves stop uninitialized', () => {
  const fixture = launcherFixture();
  try {
    const state = path.join(fixture.dir, 'selected');
    const result = fixture.run('start', state);
    assert.equal(result.status, 0, result.stderr);
    const calls = fixture.calls(state);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.at(-1), path.join(state, 'instances/workharbor/config.json'));
    assert.equal(calls[0].args.at(-2), '../scripts/workharbor-bootstrap.ts');
    assert.equal(calls[1].args[0], 'dev:once');
    const stopState = path.join(fixture.dir, 'stop-only');
    assert.equal(fixture.run('stop', stopState).status, 0);
    assert.equal(fixture.calls(stopState).length, 1);
    assert.equal(existsSync(path.join(stopState, 'instances/workharbor/.env')), false);
  } finally { rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('does not start the server after bootstrap fails', () => {
  const fixture = launcherFixture();
  try {
    const state = path.join(fixture.dir, 'bootstrap-failure');
    assert.equal(fixture.run('start', state).status, 86);
    assert.equal(fixture.calls(state).length, 1);
  } finally { rmSync(fixture.dir, { recursive: true, force: true }); }
});

function launcherFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'workharbor-launch-sequence-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'pnpm'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const config = process.env.PAPERCLIP_CONFIG, args = process.argv.slice(2);
const state = process.env.PAPERCLIP_HOME;
fs.mkdirSync(path.dirname(config), { recursive: true });
fs.appendFileSync(path.join(state, 'calls.jsonl'), JSON.stringify({args}) + '\\n');
if (args.includes('../scripts/workharbor-bootstrap.ts')) {
  if (path.basename(state) === 'bootstrap-failure') process.exit(86);
  fs.writeFileSync(path.join(path.dirname(config), '.env'), 'PAPERCLIP_AGENT_JWT_SECRET=synthetic-fixture\\n');
} else if (args[0] === 'dev:once' && !fs.existsSync(path.join(path.dirname(config), '.env'))) process.exit(87);
`, { mode: 0o755 });
  return {
    dir,
    run: (action, state) => spawnSync(process.execPath, [fileURLToPath(new URL('./workharbor-local.mjs', import.meta.url)), action, '--state-dir', state], { encoding: 'utf8', env: { PATH: bin + path.delimiter + process.env.PATH } }),
    calls: (state) => readFileSync(path.join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse),
  };
}
