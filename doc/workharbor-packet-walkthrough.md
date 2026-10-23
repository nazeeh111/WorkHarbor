# Try a selected-file review

This walkthrough uses the existing packet helper with a disposable Git repository. Run it from the WorkHarbor clone with Node.js 24 and Git. No dependency install, application server, database, provider or model is needed.

## Capture a small change

The temporary directory is printed at the end. All example files and the local fixture commit stay there; your WorkHarbor checkout is not changed.

```sh
packet_helper="$PWD/scripts/change-packet.mjs"
packet_demo=$(mktemp -d "${TMPDIR:-/tmp}/workharbor-packet.XXXXXX")
packet_demo=$(cd "$packet_demo" && pwd -P)
git init --quiet "$packet_demo"
printf 'Review the original draft.\n' > "$packet_demo/draft.txt"
git -C "$packet_demo" add draft.txt
git -C "$packet_demo" -c user.name='Packet Example' -c user.email='packet@example.invalid' -c commit.gpgsign=false commit --quiet -m 'Local example base'
printf 'Review the revised draft and its evidence.\n' > "$packet_demo/draft.txt"

node "$packet_helper" create --repo "$packet_demo" --file draft.txt --out "$packet_demo/packet.json"
node "$packet_helper" verify "$packet_demo/packet.json"
node "$packet_helper" check-current "$packet_demo/packet.json" --repo "$packet_demo"
printf 'Example files: %s\n' "$packet_demo"
```

The first command prints the packet's SHA-256 digest. Verification checks the packet's bytes and metadata; `check-current` confirms that the selected `draft.txt` still matches its captured version. The packet records the original and revised text as base64 along with their sizes and hashes. It includes only the one explicitly selected path.

## Watch the snapshot become stale

```sh
printf 'A later edit needs a new review snapshot.\n' > "$packet_demo/draft.txt"
node "$packet_helper" check-current "$packet_demo/packet.json" --repo "$packet_demo"
```

Expected: nonzero exit and `Selected files differ from the packet snapshot: draft.txt`. The earlier JSON is still internally valid, so `verify` can pass while `check-current` fails. These answer different questions.

Keep the original packet and capture the revised file into a new one:

```sh
node "$packet_helper" create --repo "$packet_demo" --file draft.txt --out "$packet_demo/revised-packet.json"
node "$packet_helper" check-current "$packet_demo/revised-packet.json" --repo "$packet_demo"
```

This returns success for the new snapshot. The helper refuses to overwrite an existing packet; choose a fresh filename for each capture.

## Bring the evidence to the task

When using the local app, attach the selected JSON packet to its task and record its printed digest separately in a review comment. A reviewer compares that reference using `verify --expected-digest`, checks the checkout again where available, inspects the selected bytes, and records their decision. Creating a packet does not approve the task or trigger a provider.

The packet embeds both sides of every selected file. Select only material suitable for the reviewer. This example uses synthetic text and a disposable local commit; it establishes no live-agent result. See [the complete packet contract](workharbor-change-packets.md) for limits, path restrictions and the manual review procedure.
