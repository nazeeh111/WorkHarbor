import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { localCommand } from './workharbor-local.mjs';

test('isolates instance state and does not forward provider/database/cloud configuration', () => {
  const inherited = {PATH: '/bin', HOME: '/user', OPENAI_API_KEY: 'fixture', DATABASE_URL: 'fixture', PAPERCLIP_CONFIG: '/other/config', PAPERCLIP_HOME: '/other', PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: 'fixture'};
  const spec = localCommand([], inherited, '/repo');
  assert.equal(spec.env.HOME, '/user');
  assert.equal(spec.env.PAPERCLIP_HOME, path.resolve('/repo/.workharbor'));
  assert.equal(spec.env.PAPERCLIP_CONFIG, path.resolve('/repo/.workharbor/instances/workharbor/config.json'));
  for (const key of ['OPENAI_API_KEY','DATABASE_URL','PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN']) assert.equal(spec.env[key], undefined);
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
