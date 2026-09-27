# WorkHarbor Change Packets

A Change Packet is a portable, read-only snapshot of explicitly selected files against a Git base commit. It gives a reviewer the exact original and proposed bytes, including binary files, in one deterministic JSON artifact. WorkHarbor does not treat the packet as an automatic approval gate.

## Create and check a packet

Run the helper from WorkHarbor with Node 24 or newer. `--repo` may point to the Git checkout being changed. The output directory must already exist and must not pass through a symlink. The output file must be new.

```sh
node scripts/change-packet.mjs create \
  --repo /path/to/project \
  --base HEAD \
  --file src/changed.ts \
  --file assets/sample.bin \
  --file src/removed.ts \
  --out /path/to/existing-review-folder/change-packet.json
```

`--base` defaults to the checkout's current `HEAD`; it can also name another Git revision. Paths passed with `--file` are relative to the selected repository root. The list is mandatory and is the full declared scope: the helper does not discover or include other changed, untracked, or ignored files. It records additions and deletions when the path is present on one side and absent on the other. A path absent from both sides is rejected.

The manifest records the repository directory name and resolved base commit SHA. For every selected path it stores base and current bytes as base64, byte lengths, SHA-256 digests, and an added/modified/deleted/unchanged label. Files are sorted by path; JSON uses canonical key order. The manifest digest covers the metadata and all embedded bytes.

```sh
node scripts/change-packet.mjs verify /path/to/change-packet.json
node scripts/change-packet.mjs check-current /path/to/change-packet.json --repo /path/to/project
```

`verify` checks the canonical JSON, each payload length and digest, status labels, and the overall manifest digest. `check-current` also confirms that every selected path in the checkout still has the packet's captured current bytes. It reports selected paths that changed since capture.

## Human review workflow

1. Create the packet after the task's implementation and relevant checks are complete.
2. Run `verify`, then attach the JSON artifact to the WorkHarbor task using the normal attachment UI.
3. Record the printed manifest digest in the task's review comment alongside the base commit, selected paths, and verification commands/results. The comment is the separate reviewer reference for the digest.
4. The reviewer downloads the attachment and runs `verify <manifest> --expected-digest <recorded-sha256>`. If checking a checkout, they also run `check-current <manifest> --repo <checkout> --expected-digest <recorded-sha256>`.
5. The reviewer inspects the packet and records their verdict through WorkHarbor's existing review flow. Any later edit to a selected file requires a new packet and a new recorded digest.

The expected digest detects a replacement packet only when compared with a digest preserved separately from the packet. SHA-256 here is an integrity check, not a signature: it does not identify the author or prevent someone from changing both the packet and the separate record.

## Boundaries

- This checks selected-file snapshots, not whole-worktree integrity. Excluded files, build outputs, environment state, and unstaged changes outside the selection are not represented.
- `check-current` compares bytes for selected paths; it does not prove that those bytes were produced by the recorded base commit or that the rest of the checkout is clean.
- Path checks reject absolute/traversing paths, symlinks, `.git`, common credential-store locations such as `.aws`, `.ssh`, `.docker`, and `.config/gcloud`, credential config files such as `.npmrc` and `.pypirc`, `.env*`, and common private-key file extensions. This is a path filter, not a secret scanner; do not include credentials or rely on it to find them.
- The helper runs fixed, read-only Git metadata/content commands. It does not run project commands, upload artifacts, call APIs, create signatures, merge, push, or publish.
- Creating or verifying a packet does not update, invalidate, or bind a native WorkHarbor/Paperclip UI decision automatically. A reviewer must inspect the exact attachment and record its digest as part of the manual review. Existing UI decision IDs remain separate from the packet's file-byte digest.
- The packet contains a base64 copy of every selected file on both sides. Keep the output in an appropriate review location and select only files suitable for sharing with reviewers.

The helper allows at most 100 selected files, 2 MiB per file, and 16 MiB of combined base/current file bytes. The manifest can be larger than the payload because base64 expands binary data.
