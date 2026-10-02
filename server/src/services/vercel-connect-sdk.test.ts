import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenResponse } from "@vercel/connect";
import {
  createVercelConnectClient,
  vercelConnectCallbackUrl,
  vercelGrantReference,
  type VercelConnectTokenRequest,
} from "./vercel-connect.js";

const { oidc } = vi.hoisted(() => ({ oidc: vi.fn(async () => "offline-workload-token") }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: oidc }));

let sequence = 0;
function request(): VercelConnectTokenRequest {
  return {
    connector: `offline-connector-${sequence++}`,
    subject: { type: "user", id: "company-bound-user" },
    scopes: ["read", "write"],
    resources: ["https://fixture.example/mcp"],
    installationId: "installation-fixture",
  };
}
function token(bearer = "offline-provider-token") {
  return {
    token: bearer,
    tokenId: "token-fixture",
    expiresAt: Date.now() + 120_000,
    connector: { id: "connector-fixture", uid: "fixture", type: "oauth" },
    installationId: "installation-fixture",
    tenantId: "tenant-fixture",
    claims: { email: "not-for-storage@example.test" },
    metadata: { privateValue: "not-for-storage" },
  };
}
const transport = vi.fn<typeof fetch>();
beforeEach(() => {
  oidc.mockClear();
  transport.mockReset();
  transport.mockImplementation(async () => Response.json(token()));
  vi.stubGlobal("fetch", transport);
  vi.stubEnv("VERCEL_OIDC_TOKEN", "offline-workload-token");
  vi.stubEnv("PAPERCLIP_VERCEL_CONNECT_ACCESS_TOKEN", "offline-fallback-token");
  vi.stubEnv("VERCEL_REGION", "");
  vi.stubEnv("VERCEL_CONNECT_INTERACTIVE_AUTH_MODE", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function sentBody(index = 0): unknown {
  const init = transport.mock.calls[index]?.[1];
  return JSON.parse(String(init?.body));
}

describe("Vercel Connect real SDK offline boundary", () => {
  it("characterizes why missing stored scopes must be rejected before the SDK", async () => {
    await getTokenResponse(`upstream-default-${sequence++}`, { subject: { type: "app" } });
    expect(sentBody()).toEqual({ subject: { type: "app" }, scopes: ["*"] });
  });

  // JSON fixtures model the stored JSON boundary, without asserting an invalid
  // object is a valid typed request. The missing scope fixture omits the key.
  it.each([
    { label: "missing", scopes: undefined }, { label: "null", scopes: null },
    { label: "scalar", scopes: "read" }, { label: "empty array", scopes: [] },
    { label: "null member", scopes: [null] }, { label: "empty member", scopes: [""] },
    { label: "blank member", scopes: ["   "] }, { label: "non-string member", scopes: ["read", 12] },
  ])(
    "rejects $label stored scopes without token or authorization requests",
    async ({ scopes }) => {
      const stored = JSON.parse(JSON.stringify({ ...request(), scopes }));
      const client = createVercelConnectClient();
      await expect(client.getToken(stored)).rejects.toMatchObject({ status: 422 });
      await expect(client.startAuthorization(stored, "http://localhost/callback"))
        .rejects.toMatchObject({ status: 422 });
      expect(transport).not.toHaveBeenCalled();
      expect(oidc).not.toHaveBeenCalled();
    },
  );

  it("preserves explicit reviewed scopes, subject, resources and installation at the token boundary", async () => {
    const input = request();
    const response = await createVercelConnectClient().getToken(input);
    expect(sentBody()).toEqual({
      subject: { type: "user", id: "company-bound-user" },
      scopes: ["read", "write"],
      resources: ["https://fixture.example/mcp"],
      installationId: "installation-fixture",
    });
    expect(transport.mock.calls[0]?.[0]).toBe(`https://api.vercel.com/v1/connect/token/${input.connector}`);
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer offline-workload-token");
    expect(response.token).toBe("offline-provider-token");
  });

  it.each([
    { label: "missing", scopes: undefined }, { label: "null", scopes: null },
    { label: "scalar", scopes: "read" }, { label: "empty array", scopes: [] },
    { label: "null member", scopes: [null] }, { label: "empty member", scopes: [""] },
    { label: "blank member", scopes: ["   "] }, { label: "non-string member", scopes: ["read", 12] },
  ])("evicts legacy $label scope caches without blocking revocation or authorizing tokens", async ({ scopes }) => {
    const input = request();
    const stored = JSON.parse(JSON.stringify({ ...input, scopes }));
    const legacyParams = {
      subject: stored.subject, scopes: stored.scopes,
      resources: stored.resources, installationId: stored.installationId,
    };
    // Seed through the real SDK to model a cache populated before validation.
    // Subsequent adapter acquisition must reject even while that cache is warm.
    expect((await getTokenResponse(input.connector, legacyParams)).token).toBe("offline-provider-token");
    expect((await getTokenResponse(input.connector, legacyParams)).token).toBe("offline-provider-token");
    expect(transport).toHaveBeenCalledTimes(1);
    const client = createVercelConnectClient();
    await expect(client.getToken(stored)).rejects.toMatchObject({ status: 422 });
    await expect(client.startAuthorization(stored, "http://localhost/callback"))
      .rejects.toMatchObject({ status: 422 });
    oidc.mockClear();
    transport.mockClear();
    // Cleanup callers evict synchronously before their local cleanup/revocation.
    expect(() => client.evict(stored)).not.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(oidc).not.toHaveBeenCalled();
    transport.mockImplementationOnce(async () => Response.json(token("after-legacy-eviction")));
    expect((await getTokenResponse(input.connector, legacyParams)).token).toBe("after-legacy-eviction");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicitly reviewed wildcard rather than treating it as omitted scopes", async () => {
    await createVercelConnectClient().getToken({ ...request(), scopes: ["*"] });
    expect(sentBody()).toMatchObject({ scopes: ["*"] });
  });

  it("serializes authorization scopes and canonical callback with the access-token fallback", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    transport.mockResolvedValue(Response.json({ request: "authorization-fixture", url: "https://fixture.example/authorize" }));
    const input = request();
    const response = await createVercelConnectClient().startAuthorization(
      input, vercelConnectCallbackUrl("http://127.0.0.1:3180/", "one-time-state"),
    );
    expect(sentBody()).toEqual({
      subject: { type: "user", id: "company-bound-user" }, scopes: ["read", "write"],
      resources: ["https://fixture.example/mcp"], installationId: "installation-fixture",
      returnUrl: "http://localhost:3180/api/tools/vercel-connect/callback?state=one-time-state",
    });
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer offline-fallback-token");
    expect(oidc).not.toHaveBeenCalled();
    expect(response.url).toBe("https://fixture.example/authorize");
  });

  it("refreshes and evicts real SDK cached tokens without provisioning or widening scopes", async () => {
    const input = request();
    const client = createVercelConnectClient();
    transport.mockImplementationOnce(async () => Response.json(token("first-token")));
    expect((await client.getToken(input)).token).toBe("first-token");
    expect((await client.getToken(input)).token).toBe("first-token");
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await client.getToken(input, { forceRefresh: true })).token).toBe("offline-provider-token");
    client.evict(input);
    transport.mockImplementationOnce(async () => Response.json(token("after-eviction")));
    expect((await client.getToken(input)).token).toBe("after-eviction");
    expect(transport).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 3; index++) {
      expect(sentBody(index)).toMatchObject({ scopes: ["read", "write"] });
      expect(String(transport.mock.calls[index]?.[0])).toContain("/v1/connect/token/");
    }
  });

  it("uses region routing while preserving the grant storage allowlist", async () => {
    vi.stubEnv("VERCEL_REGION", "sfo1");
    const input = request();
    const response = await createVercelConnectClient().getToken(input);
    expect(transport.mock.calls[0]?.[0]).toBe(`https://api-sfo1.vercel.com/v1/connect/token/${input.connector}`);
    const reference = vercelGrantReference({
      credential: {
        provider: "vercel_connect", connectorId: "connector-fixture", connectorUid: "fixture",
        service: "fixture", connectorType: "oauth", principalMode: "user",
        headerName: "Authorization", headerPrefix: "Bearer ", scopes: ["read", "write"],
      },
      token: response, subjectId: "company-bound-user", verifiedAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(Object.keys(reference).sort()).toEqual([
      "expiresAt", "installationId", "lastVerifiedAt", "provider", "subjectId", "subjectType", "tenantId", "tokenId",
    ]);
    expect(JSON.stringify(reference)).not.toContain("offline-provider-token");
    expect(JSON.stringify(reference)).not.toContain("not-for-storage");
  });

  it.each([
    [409, "user_authorization_required", "vercel_connect_authorization_required", 409],
    [409, "connector_installation_required", "vercel_connect_installation_required", 409],
    [401, "unauthorized", "vercel_connect_auth_failed", 503],
    [403, "forbidden", "vercel_connect_auth_failed", 503],
    [404, "missing", "vercel_connect_connector_not_found", 422],
  ])("maps real authorization error %s/%s without leaking upstream details", async (status, upstreamCode, code, expectedStatus) => {
    transport.mockResolvedValue(Response.json({ error: { code: upstreamCode, message: "private-upstream-details" } }, { status: Number(status) }));
    const failure = await createVercelConnectClient().startAuthorization(request(), "http://localhost/callback").catch((error: unknown) => error);
    expect(failure).toMatchObject({ code, status: expectedStatus });
    expect(String(failure)).not.toContain("private-upstream-details");
  });
});
