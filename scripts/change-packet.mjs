#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const FORMAT = "workharbor-change-packet";
const VERSION = 1;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const BLOCKED_STORE_COMPONENTS = new Set([".aws", ".ssh", ".gnupg", ".azure", ".kube", ".docker", ".netrc", ".git-credentials"]);
const BLOCKED_CREDENTIAL_NAMES = new Set([
  ".npmrc", ".pypirc",
  "credentials", "credentials.json", "credentials.yaml", "credentials.yml",
  "secrets", "secrets.json", "secrets.yaml", "secrets.yml",
  "token.json", "tokens.json", "access_token", "access-token", "refresh_token", "refresh-token",
  "api_key", "api-key", "api_key.json", "api-key.json", "private_key", "private-key",
  "id_rsa", "id_ecdsa", "id_ed25519", "id_dsa",
]);

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function parseOptions(args, { allowFiles = false, allowedSingles = [] } = {}) {
  const options = { files: [] };
  const single = new Set(allowedSingles);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--file" && allowFiles) {
      const value = args[++index];
      if (!value || value.startsWith("--")) fail("--file requires a relative path");
      options.files.push(value);
      continue;
    }
    if (!single.has(flag)) fail(`Unknown option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    if (Object.hasOwn(options, flag)) fail(`${flag} may be supplied only once`);
    options[flag] = value;
  }
  return options;
}

function validatePath(selected) {
  if (typeof selected !== "string" || selected.length === 0) fail("Selected paths must be non-empty relative paths");
  if (selected.length > 1024 || selected.startsWith("/") || /^[a-z]:/i.test(selected) || selected.includes("\\") || /[\u0000-\u001f\u007f]/.test(selected)) {
    fail(`Unsafe selected path: ${JSON.stringify(selected)}`);
  }
  const components = selected.split("/");
  if (components.some((part) => !part || part === "." || part === "..")) fail(`Unsafe selected path: ${JSON.stringify(selected)}`);
  const lower = components.map((part) => part.toLowerCase());
  const cloudCredentialDir = lower.some((part, index) => part === ".config" && ["gcloud", "gh", "azure"].includes(lower[index + 1]));
  if (components.some((part) => part.toLowerCase() === ".git" || BLOCKED_STORE_COMPONENTS.has(part.toLowerCase()) || /^\.env(?:$|\.)/i.test(part) || BLOCKED_CREDENTIAL_NAMES.has(part.toLowerCase()) || /\.(?:pem|p12|pfx|jks|key)$/i.test(part)) || cloudCredentialDir) {
    fail(`Credential or repository metadata path is not allowed: ${selected}`);
  }
  return selected;
}

function assertNoSymlinkComponents(root, selected, { allowMissingTail = true } = {}) {
  const components = selected.split("/");
  let cursor = root;
  for (let index = 0; index < components.length; index += 1) {
    cursor = path.join(cursor, components[index]);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error.code === "ENOENT" && allowMissingTail) return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(`Symlink paths are not allowed: ${selected}`);
    if (index < components.length - 1 && !stat.isDirectory()) {
      if (allowMissingTail && !stat.isFile()) return;
      fail(`A parent of ${selected} is not a directory`);
    }
  }
}

function validateRepo(repoArgument) {
  const requested = realpathSync(repoArgument || process.cwd());
  const top = execFileSync("git", ["-C", requested, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const root = realpathSync(top);
  const commit = execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8" }).trim();
  if (!COMMIT_RE.test(commit)) fail("Git returned an invalid HEAD commit identifier");
  return { root, head: commit };
}

function resolveCommit(root, base) {
  if (typeof base !== "string" || !base || base.startsWith("-") || /[\u0000-\u001f\u007f]/.test(base) || base.length > 200) {
    fail("--base must name a Git commit or revision");
  }
  const commit = execFileSync("git", ["-C", root, "rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], { encoding: "utf8" }).trim();
  if (!COMMIT_RE.test(commit)) fail("Git returned an invalid base commit identifier");
  return commit;
}

function sourcePayload(bytes) {
  return {
    present: true,
    encoding: "base64",
    byteLength: bytes.length,
    sha256: sha256(bytes),
    data: bytes.toString("base64"),
  };
}

function gitBaseBytes(root, commit, selected) {
  const listing = execFileSync("git", ["--literal-pathspecs", "-C", root, "ls-tree", "-z", "--full-tree", commit, "--", selected], { encoding: "buffer" });
  const records = listing.toString("utf8").split("\0").filter(Boolean);
  const exact = records.map((record) => {
    const tab = record.indexOf("\t");
    if (tab < 0) fail(`Could not parse Git tree entry for ${selected}`);
    return { metadata: record.slice(0, tab).split(" "), file: record.slice(tab + 1) };
  }).filter((record) => record.file === selected);
  if (exact.length === 0) return null;
  if (exact.length !== 1) fail(`Ambiguous Git tree entries for ${selected}`);
  const [mode, type] = exact[0].metadata;
  if (mode === "120000") fail(`Base revision contains a symlink: ${selected}`);
  if (mode === "160000" || type !== "blob") fail(`Base revision path is not a regular file: ${selected}`);
  const object = `${commit}:${selected}`;
  const sizeText = execFileSync("git", ["-C", root, "cat-file", "-s", object], { encoding: "utf8" }).trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) fail(`File exceeds ${MAX_FILE_BYTES} byte limit: ${selected}`);
  return execFileSync("git", ["-C", root, "cat-file", "blob", object], { encoding: "buffer", maxBuffer: MAX_FILE_BYTES + 1 });
}

function currentBytes(root, selected) {
  assertNoSymlinkComponents(root, selected);
  const absolute = path.join(root, ...selected.split("/"));
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Selected path is not a regular file: ${selected}`);
  if (stat.size > MAX_FILE_BYTES) fail(`File exceeds ${MAX_FILE_BYTES} byte limit: ${selected}`);
  const bytes = readFileSync(absolute);
  if (bytes.length > MAX_FILE_BYTES) fail(`File exceeds ${MAX_FILE_BYTES} byte limit: ${selected}`);
  return bytes;
}

function statusFor(base, current) {
  if (!base && !current) fail("A selected path is absent from both the base revision and current checkout");
  if (!base) return "added";
  if (!current) return "deleted";
  return base.sha256 === current.sha256 ? "unchanged" : "modified";
}

function makeEntry(root, commit, selected) {
  const baseBytes = gitBaseBytes(root, commit, selected);
  const current = currentBytes(root, selected);
  const base = baseBytes === null ? null : sourcePayload(baseBytes);
  const now = current === null ? null : sourcePayload(current);
  return { path: selected, status: statusFor(base, now), base, current: now };
}

function manifestDigest(manifest) {
  const { manifestDigest: ignored, ...unsigned } = manifest;
  return sha256(Buffer.from(canonicalJson(unsigned), "utf8"));
}

function validateOutputPath(file) {
  const absolute = path.resolve(file);
  const components = absolute.slice(path.parse(absolute).root.length).split(path.sep);
  let cursor = path.parse(absolute).root;
  for (const component of components.slice(0, -1)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error.code === "ENOENT") fail(`Output parent directory does not exist: ${cursor}`);
      throw error;
    }
    if (stat.isSymbolicLink()) fail(`Output directory contains a symlink: ${cursor}`);
    if (!stat.isDirectory()) fail(`Output parent is not a directory: ${cursor}`);
  }
  return absolute;
}

function writeNewFile(file, bytes) {
  const absolute = validateOutputPath(file);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0);
  const fd = openSync(absolute, flags, 0o600);
  try {
    writeFileSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}

function createPacket(args) {
  const options = parseOptions(args, { allowFiles: true, allowedSingles: ["--repo", "--base", "--out"] });
  if (!options["--out"]) fail("create requires --out with a new output path");
  if (options.files.length === 0) fail("create requires at least one explicit --file path");
  if (options.files.length > MAX_FILES) fail(`At most ${MAX_FILES} files may be selected`);
  const files = options.files.map(validatePath).sort();
  if (new Set(files).size !== files.length) fail("Duplicate selected file paths are not allowed");
  const { root, head } = validateRepo(options["--repo"]);
  const outputPath = validateOutputPath(options["--out"]);
  const selectedAbsolutePaths = new Set(files.map((selected) => path.resolve(root, ...selected.split("/"))));
  if (selectedAbsolutePaths.has(outputPath)) fail("Output path may not also be a selected source file");
  const baseCommit = resolveCommit(root, options["--base"] || head);
  let totalBytes = 0;
  const entries = files.map((selected) => {
    assertNoSymlinkComponents(root, selected);
    const entry = makeEntry(root, baseCommit, selected);
    totalBytes += (entry.base?.byteLength || 0) + (entry.current?.byteLength || 0);
    if (totalBytes > MAX_TOTAL_BYTES) fail(`Change Packet payload exceeds ${MAX_TOTAL_BYTES} byte limit`);
    return entry;
  });
  const manifest = {
    format: FORMAT,
    version: VERSION,
    scope: "selected-files-only",
    source: { repository: path.basename(root), baseCommit },
    files: entries,
    manifestDigest: "",
  };
  manifest.manifestDigest = manifestDigest(manifest);
  writeNewFile(outputPath, Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"));
  process.stdout.write(`Created Change Packet for ${entries.length} selected files (${manifest.manifestDigest}).\n`);
}

function validateKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (canonicalJson(actual) !== canonicalJson([...keys].sort())) fail(`${label} has unexpected or missing fields`);
}

function validatePayload(payload, label) {
  if (payload === null) return null;
  validateKeys(payload, ["present", "encoding", "byteLength", "sha256", "data"], label);
  if (payload.present !== true || payload.encoding !== "base64") fail(`${label} has an unsupported encoding or state`);
  if (!Number.isSafeInteger(payload.byteLength) || payload.byteLength < 0 || payload.byteLength > MAX_FILE_BYTES) fail(`${label} has an invalid byteLength`);
  if (typeof payload.sha256 !== "string" || !SHA256_RE.test(payload.sha256)) fail(`${label} has an invalid SHA-256 digest`);
  if (typeof payload.data !== "string") fail(`${label} data must be base64 text`);
  const bytes = Buffer.from(payload.data, "base64");
  if (bytes.toString("base64") !== payload.data) fail(`${label} is not canonical base64`);
  if (bytes.length !== payload.byteLength || sha256(bytes) !== payload.sha256) fail(`${label} content digest or length does not match`);
  return payload;
}

function readAndVerify(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("Change Packet must be a regular file, not a symlink");
  if (stat.size > MAX_TOTAL_BYTES * 2) fail("Change Packet manifest exceeds the size limit");
  const raw = readFileSync(file);
  if (raw.length > MAX_TOTAL_BYTES * 2) fail("Change Packet manifest exceeds the size limit");
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("Change Packet is not valid JSON");
  }
  validateKeys(manifest, ["format", "version", "scope", "source", "files", "manifestDigest"], "Change Packet manifest");
  if (manifest.format !== FORMAT || manifest.version !== VERSION || manifest.scope !== "selected-files-only") fail("Unsupported Change Packet format or scope");
  validateKeys(manifest.source, ["repository", "baseCommit"], "Change Packet source");
  if (typeof manifest.source.repository !== "string" || !manifest.source.repository || /[\u0000-\u001f\u007f/\\]/.test(manifest.source.repository)) fail("Invalid source repository label");
  if (typeof manifest.source.baseCommit !== "string" || !COMMIT_RE.test(manifest.source.baseCommit)) fail("Invalid source base commit");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > MAX_FILES) fail("Invalid selected file list");
  let totalBytes = 0;
  let previous = "";
  for (const [index, entry] of manifest.files.entries()) {
    validateKeys(entry, ["path", "status", "base", "current"], `files[${index}]`);
    validatePath(entry.path);
    if (entry.path <= previous) fail("Selected file paths must be unique and sorted");
    previous = entry.path;
    const base = validatePayload(entry.base, `${entry.path} base`);
    const current = validatePayload(entry.current, `${entry.path} current`);
    const actualStatus = statusFor(base, current);
    if (entry.status !== actualStatus) fail(`Status does not match payloads for ${entry.path}`);
    totalBytes += (base?.byteLength || 0) + (current?.byteLength || 0);
    if (totalBytes > MAX_TOTAL_BYTES) fail("Change Packet payload exceeds the size limit");
  }
  if (typeof manifest.manifestDigest !== "string" || !SHA256_RE.test(manifest.manifestDigest) || manifestDigest(manifest) !== manifest.manifestDigest) {
    fail("Change Packet manifest digest does not match");
  }
  const canonicalBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  if (!raw.equals(canonicalBytes)) fail("Change Packet JSON is not in canonical form");
  return manifest;
}

function verifyPacket(manifestPath, args) {
  if (!manifestPath) fail("verify requires a manifest path");
  const options = parseOptions(args, { allowedSingles: ["--expected-digest"] });
  const manifest = readAndVerify(manifestPath);
  checkExpectedDigest(options["--expected-digest"], manifest);
  process.stdout.write(`Verified Change Packet (${manifest.files.length} selected files, ${manifest.manifestDigest}).\n`);
}

function checkCurrent(manifestPath, args) {
  if (!manifestPath) fail("check-current requires a manifest path");
  const options = parseOptions(args, { allowedSingles: ["--repo", "--expected-digest"] });
  const manifest = readAndVerify(manifestPath);
  checkExpectedDigest(options["--expected-digest"], manifest);
  const { root } = validateRepo(options["--repo"]);
  const changed = [];
  for (const entry of manifest.files) {
    const bytes = currentBytes(root, entry.path);
    if (bytes === null && entry.current === null) continue;
    if (bytes !== null && entry.current !== null && sha256(bytes) === entry.current.sha256 && bytes.length === entry.current.byteLength) continue;
    changed.push(entry.path);
  }
  if (changed.length) fail(`Selected files differ from the packet snapshot: ${changed.join(", ")}`);
  process.stdout.write(`Current checkout matches all ${manifest.files.length} selected file snapshots.\n`);
}

function checkExpectedDigest(expected, manifest) {
  if (expected === undefined) return;
  if (!SHA256_RE.test(expected)) fail("--expected-digest must be a 64-character SHA-256 hex digest");
  if (expected !== manifest.manifestDigest) fail("Change Packet digest differs from --expected-digest");
}

function usage() {
  return [
    "Usage:",
    "  node scripts/change-packet.mjs create --file <relative-path> [--file <relative-path> ...] --out <new-manifest.json> [--repo <git-root>] [--base <revision>]",
    "  node scripts/change-packet.mjs verify <manifest.json> [--expected-digest <sha256>]",
    "  node scripts/change-packet.mjs check-current <manifest.json> [--repo <git-root>] [--expected-digest <sha256>]",
  ].join("\n");
}

function main(args) {
  const [command, ...rest] = args;
  if (command === "create") return createPacket(rest);
  if (command === "verify") return verifyPacket(rest[0], rest.slice(1));
  if (command === "check-current") return checkCurrent(rest[0], rest.slice(1));
  fail(usage());
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`Change Packet error: ${error.message}\n`);
  process.exitCode = 1;
}
