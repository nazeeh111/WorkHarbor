import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const bootstrap = path.join(repoRoot, "scripts/workharbor-bootstrap.ts");
const roots: string[] = [];
const originalEnv = process.env;
const originalArgv = process.argv;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workharbor-bootstrap-"));
  roots.push(root);
  const config = path.join(root, "selected state/instances/workharbor/config.json");
  const envFile = path.join(path.dirname(config), ".env");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  return {
    root, config, envFile,
    run: async (args: string[] = [config]) => {
      process.env = {
        PATH: originalEnv.PATH,
        PAPERCLIP_HOME: root,
        PAPERCLIP_CONFIG: config,
        PAPERCLIP_INSTANCE_ID: "workharbor",
        PAPERCLIP_DISABLE_CWD_ENV_FILE: "true",
      };
      process.argv = [process.execPath, bootstrap, ...args];
      vi.resetModules();
      await import("../../../scripts/workharbor-bootstrap.js");
    },
  };
}

afterEach(() => {
  process.env = originalEnv;
  process.argv = originalArgv;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("WorkHarbor selected-instance agent auth bootstrap", () => {
  it("creates a missing instance key without creating a config or logging key material", async () => {
    const f = fixture();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await f.run();
    expect(stdout.mock.calls.length === 0 && stderr.mock.calls.length === 0).toBe(true);
    expect(/^PAPERCLIP_AGENT_JWT_SECRET=[a-f0-9]{64}$/m.test(fs.readFileSync(f.envFile, "utf8"))).toBe(true);
    expect(fs.existsSync(f.config)).toBe(false);
    expect(fs.statSync(f.envFile).mode & 0o777).toBe(0o600);
  });

  it("preserves an existing valid key, adjacent env bytes and config bytes across restarts", async () => {
    const f = fixture();
    const contents = "# operator fixture\r\nPAPERCLIP_AGENT_JWT_SECRET='synthetic-existing-key'\r\nOTHER=value\r\n";
    const config = "{\"operatorFixture\":true}\r\n";
    fs.writeFileSync(f.envFile, contents, { mode: 0o600 });
    fs.writeFileSync(f.config, config);
    const inode = fs.statSync(f.envFile).ino;
    for (let i = 0; i < 2; i++) {
      await f.run();
      expect(fs.readFileSync(f.envFile, "utf8") === contents).toBe(true);
      expect(fs.readFileSync(f.config, "utf8") === config).toBe(true);
      expect(fs.statSync(f.envFile).ino === inode).toBe(true);
    }
  });

  it("uses only the explicit selected path despite an ancestor instance", async () => {
    const f = fixture();
    const other = path.join(f.root, ".paperclip");
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, "config.json"), "unrelated config fixture");
    const sentinel = "PAPERCLIP_AGENT_JWT_SECRET=unrelated-fixture\n";
    fs.writeFileSync(path.join(other, ".env"), sentinel);
    await f.run();
    expect(fs.readFileSync(path.join(other, ".env"), "utf8") === sentinel).toBe(true);
    expect(fs.readFileSync(path.join(other, "config.json"), "utf8") === "unrelated config fixture").toBe(true);
    expect(fs.readFileSync(f.envFile, "utf8").includes("unrelated-fixture")).toBe(false);
    expect(fs.existsSync(path.join(f.root, "instances"))).toBe(false);
  });

  it("preserves the supported BETTER_AUTH_SECRET fallback without rotating signing identity", async () => {
    const f = fixture();
    const contents = "# fallback fixture\r\nBETTER_AUTH_SECRET='synthetic-existing-fallback'\r\nOTHER=value\r\n";
    fs.writeFileSync(f.envFile, contents, { mode: 0o600 });
    const inode = fs.statSync(f.envFile).ino;
    for (let i = 0; i < 2; i++) {
      await f.run();
      expect(fs.readFileSync(f.envFile, "utf8") === contents).toBe(true);
      expect(fs.statSync(f.envFile).ino === inode).toBe(true);
      expect(fs.readFileSync(f.envFile, "utf8").includes("PAPERCLIP_AGENT_JWT_SECRET")).toBe(false);
    }
  });

  it("refuses absent, relative or mismatched paths without falling back to defaults", async () => {
    const f = fixture();
    for (const args of [[], ["config.json"], [path.join(f.root, "other/config.json")]]) {
      await expect(f.run(args)).rejects.toThrow("requires its explicit selected instance config path");
    }
    expect(fs.existsSync(f.envFile)).toBe(false);
    expect(fs.existsSync(path.join(f.root, "other"))).toBe(false);
  });
});
