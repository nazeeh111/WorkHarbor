import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.join(import.meta.dirname, "change-packet.mjs");

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workharbor-change-packet-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Change Packet Test"]);
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src", "tracked.txt"), "base text\n");
  writeFileSync(path.join(root, "src", "binary.bin"), Buffer.from([0, 1, 255, 2]));
  writeFileSync(path.join(root, "src", "deleted.txt"), "will be removed\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "fixture"]);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function create(root, output = "packet.json") {
  return run(root, [
    "create", "--repo", root, "--base", "HEAD",
    "--file", "src/tracked.txt",
    "--file", "src/binary.bin",
    "--file", "src/new.txt",
    "--file", "src/deleted.txt",
    "--out", output,
  ]);
}

function prepareAddedAndDeleted(root) {
  writeFileSync(path.join(root, "src", "new.txt"), "new bytes\n");
  rmSync(path.join(root, "src", "deleted.txt"));
}

test("create captures only explicitly selected base and current bytes, including staged, unstaged, binary, added, and deleted files", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "src", "tracked.txt"), "staged text\n");
  execFileSync("git", ["-C", root, "add", "src/tracked.txt"]);
  writeFileSync(path.join(root, "src", "tracked.txt"), "current unstaged text\n");
  writeFileSync(path.join(root, "src", "binary.bin"), Buffer.from([0, 255, 3, 0]));
  writeFileSync(path.join(root, "src", "new.txt"), "new bytes\n");
  rmSync(path.join(root, "src", "deleted.txt"));

  const result = create(root);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(root, "packet.json"), "utf8"));
  assert.equal(manifest.scope, "selected-files-only");
  assert.equal(manifest.source.baseCommit, execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  assert.deepEqual(manifest.files.map((entry) => entry.path), [
    "src/binary.bin", "src/deleted.txt", "src/new.txt", "src/tracked.txt",
  ]);
  const byPath = Object.fromEntries(manifest.files.map((entry) => [entry.path, entry]));
  assert.equal(Buffer.from(byPath["src/tracked.txt"].base.data, "base64").toString(), "base text\n");
  assert.equal(Buffer.from(byPath["src/tracked.txt"].current.data, "base64").toString(), "current unstaged text\n");
  assert.deepEqual(Buffer.from(byPath["src/binary.bin"].current.data, "base64"), Buffer.from([0, 255, 3, 0]));
  assert.equal(byPath["src/new.txt"].base, null);
  assert.equal(byPath["src/new.txt"].current.present, true);
  assert.equal(byPath["src/deleted.txt"].base.present, true);
  assert.equal(byPath["src/deleted.txt"].current, null);

  const verified = run(root, ["verify", "packet.json"]);
  assert.equal(verified.status, 0, verified.stderr);
  const current = run(root, ["check-current", "packet.json", "--repo", root]);
  assert.equal(current.status, 0, current.stderr);
});

test("manifest bytes and payload hashes are verified; a changed selected file is stale", (t) => {
  const root = fixture(t);
  prepareAddedAndDeleted(root);
  assert.equal(create(root).status, 0);
  const packetPath = path.join(root, "packet.json");
  const manifest = JSON.parse(readFileSync(packetPath, "utf8"));
  manifest.files[0].current.data = Buffer.from("tampered").toString("base64");
  writeFileSync(packetPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.notEqual(run(root, ["verify", "packet.json"]).status, 0);

  assert.equal(create(root, "fresh.json").status, 0);
  writeFileSync(path.join(root, "src", "tracked.txt"), "later edit\n");
  const stale = run(root, ["check-current", "fresh.json", "--repo", root]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /src\/tracked\.txt/);
});

test("selected paths reject traversal, absolute paths, credential-like names, and symlinks", (t) => {
  const root = fixture(t);
  const out = "unsafe.json";
  for (const selected of ["../outside.txt", "C:/outside.txt", path.join(root, "src", "tracked.txt"), ".env", "config/api-key.json"]) {
    const result = run(root, ["create", "--repo", root, "--file", selected, "--out", out]);
    assert.notEqual(result.status, 0, `accepted ${selected}`);
  assert.equal(exists(path.join(root, out)), false);
  }
  for (const selected of [".npmrc", ".pypirc", ".docker/config.json"]) {
    const result = run(root, ["create", "--repo", root, "--file", selected, "--out", out]);
    assert.notEqual(result.status, 0, `accepted known credential store ${selected}`);
    assert.match(result.stderr, /Credential or repository metadata path is not allowed/, `did not reject ${selected} in path validation`);
    assert.equal(exists(path.join(root, out)), false);
  }
  symlinkSync(path.join(root, "src", "tracked.txt"), path.join(root, "linked.txt"));
  const symlink = run(root, ["create", "--repo", root, "--file", "linked.txt", "--out", out]);
  assert.notEqual(symlink.status, 0);
  assert.equal(exists(path.join(root, out)), false);
});

test("create requires explicit files and refuses to overwrite an existing output", (t) => {
  const root = fixture(t);
  prepareAddedAndDeleted(root);
  const noFiles = run(root, ["create", "--repo", root, "--out", "packet.json"]);
  assert.notEqual(noFiles.status, 0);
  assert.equal(create(root).status, 0);
  const collision = create(root);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /exist|overwrite/i);
});

test("output paths reject symlink parents and code paths mentioning tokens remain selectable", (t) => {
  const root = fixture(t);
  prepareAddedAndDeleted(root);
  symlinkSync(path.join(root, "src"), path.join(root, "linked-dir"), "dir");
  const throughLink = create(root, "linked-dir/packet.json");
  assert.notEqual(throughLink.status, 0);
  assert.equal(exists(path.join(root, "src", "packet.json")), false);

  writeFileSync(path.join(root, "src", "tokenization.ts"), "export const tokenize = true;\n");
  const ordinaryCode = run(root, ["create", "--repo", root, "--file", "src/tokenization.ts", "--out", "code-packet.json"]);
  assert.equal(ordinaryCode.status, 0, ordinaryCode.stderr);
});

test("expected digest detects a validly rehashed replacement and command options stay scoped", (t) => {
  const root = fixture(t);
  prepareAddedAndDeleted(root);
  assert.equal(create(root).status, 0);
  const packetPath = path.join(root, "packet.json");
  const manifest = JSON.parse(readFileSync(packetPath, "utf8"));
  const recordedDigest = manifest.manifestDigest;
  manifest.source.repository = "substituted-source";
  const { manifestDigest: _old, ...unsigned } = manifest;
  manifest.manifestDigest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  writeFileSync(packetPath, `${canonicalJson(manifest)}\n`);
  assert.equal(run(root, ["verify", "packet.json"]).status, 0);
  const pinned = run(root, ["verify", "packet.json", "--expected-digest", recordedDigest]);
  assert.notEqual(pinned.status, 0);
  assert.match(pinned.stderr, /expected-digest/);
  assert.notEqual(run(root, ["verify", "packet.json", "--repo", root]).status, 0);
  assert.notEqual(run(root, ["check-current", "packet.json", "--base", "HEAD"]).status, 0);
});

test("file count and per-file size limits are enforced", (t) => {
  const root = fixture(t);
  const tooMany = ["create", "--repo", root, "--out", "many.json"];
  for (let index = 0; index < 101; index += 1) tooMany.push("--file", "src/tracked.txt");
  assert.match(run(root, tooMany).stderr, /At most 100 files/);

  writeFileSync(path.join(root, "src", "large.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
  const tooLarge = run(root, ["create", "--repo", root, "--file", "src/large.bin", "--out", "large.json"]);
  assert.notEqual(tooLarge.status, 0);
  assert.match(tooLarge.stderr, /byte limit/);
});

function exists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}
