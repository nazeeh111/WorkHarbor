import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const sdk = require.resolve("@vercel/connect");
const oidc = require.resolve("@vercel/oidc", { paths: [dirname(sdk)] });

// Resolve the SDK's own OIDC dependency so the offline mock reaches its real
// token boundary. No database or credential setup is needed by these tests.
export default defineConfig({
  resolve: { alias: { "@vercel/connect": sdk, "@vercel/oidc": oidc } },
  test: {
    environment: "node",
    include: ["src/services/vercel-connect*.test.ts"],
    server: { deps: { inline: [/@vercel[+/]connect/] } },
  },
});
