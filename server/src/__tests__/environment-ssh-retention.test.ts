import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Execute the production normalizer and POST/PATCH callback bodies without
// importing application modules or starting a server. Validation, authorization,
// persistence, providers and the transaction are mocks. The staged transaction
// below checks caller wiring and models rollback; it does not test PostgreSQL.
function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`Missing source boundary: ${start}`);
  return source.slice(from, to).trim().replace(/^export\s+/, "");
}

function routeCallback(source: string, start: string, end: string) {
  const route = between(source, start, end);
  if (!route.endsWith("});")) throw new Error(`Invalid route boundary: ${start}`);
  return route.slice(route.indexOf("async "), -2);
}

const configSource = readFileSync(new URL("../services/environment-config.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../routes/environments.ts", import.meta.url), "utf8");
const executable = stripTypeScriptTypes([
  between(configSource, "async function createEnvironmentSecret(", "/**\n * Secret pickers"),
  between(configSource, "export async function normalizeEnvironmentConfigForPersistence(",
    "export async function resolveEnvironmentDriverConfigForRuntime("),
  `this.createRoute = (${routeCallback(routesSource,
    '  router.post("/companies/:companyId/environments",',
    '  router.get("/environments/:id",')});`,
  `this.updateRoute = (${routeCallback(routesSource,
    '  router.patch("/environments/:id",',
    '  router.delete("/environments/:id",')});`,
].join("\n"), { mode: "strip" });

const OLD = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const reference = (secretId: string) => ({ type: "secret_ref", secretId, version: "latest" });
const copy = <T,>(value: T): T => structuredClone(value);
const existingConfig = {
  host: "fixture.invalid", port: 22, username: "synthetic",
  remoteWorkspacePath: "/synthetic", privateKey: null,
  privateKeySecretRef: reference(OLD), knownHosts: null, strictHostKeyChecking: true,
};

type Binding = { company: string; target: string; secret: string; path: string };
type Row = { id: string; name: string; driver: string; config: Record<string, any>; envVars: Record<string, unknown> };
type Transaction = { row: Row | null; bindings: Binding[] };
type Failure = "success" | "row" | "config-binding" | "env-binding" | "key-creation";

async function save(method: "POST" | "PATCH", input: "existing-ref" | "ui-null-ref", failure: Failure) {
  const calls: string[] = [];
  const keys = new Set([OLD]);
  let row: Row | null = method === "PATCH"
    ? { id: "env", name: "Existing", driver: "ssh", config: copy(existingConfig), envVars: {} }
    : null;
  let bindings: Binding[] = [
    { company: "company-old", target: "other-env", secret: OLD, path: "privateKeySecretRef" },
    ...(row ? [{ company: "company-old", target: "env", secret: OLD, path: "privateKeySecretRef" }] : []),
  ];
  const before = copy({ row, bindings });
  let activeTx: Transaction | undefined;
  const failAt = (stage: Failure) => {
    if (failure === stage) throw new Error(`synthetic-${stage}-failure`);
  };
  const assertExecutor = (executor: unknown) => {
    expect(activeTx).toBeDefined();
    expect(executor).toBe(activeTx);
  };
  const db = {
    transaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => {
      calls.push("transaction:start");
      const tx = { row: copy(row), bindings: copy(bindings) };
      activeTx = tx;
      try {
        const result = await fn(tx);
        row = tx.row;
        bindings = tx.bindings;
        calls.push("transaction:commit");
        return result;
      } catch (error) {
        calls.push("transaction:rollback-model");
        throw error;
      } finally {
        activeTx = undefined;
      }
    }),
  };
  const secrets = {
    create: vi.fn(async () => {
      // Creation intentionally precedes the caller's row/binding transaction.
      expect(activeTx).toBeUndefined();
      calls.push("key:create");
      failAt("key-creation");
      keys.add(NEXT);
      return { id: NEXT };
    }),
    remove: vi.fn(async (id: string) => {
      keys.delete(id);
      bindings = bindings.filter((binding) => binding.secret !== id);
      throw new Error("Automatic key deletion must not run");
    }),
    normalizeEnvBindingsForPersistence: vi.fn(async (_company: string, env: unknown) => env ?? {}),
    replaceSecretRefsForInstanceTarget: vi.fn(async (
      target: { targetId: string }, refs: { secretId: string; configPath: string }[], { db: tx }: { db: Transaction },
    ) => {
      assertExecutor(tx);
      calls.push("binding:config");
      failAt("config-binding");
      tx.bindings = tx.bindings.filter((binding) => binding.target !== target.targetId || binding.path.startsWith("env."));
      for (const ref of refs) {
        expect(keys.has(ref.secretId)).toBe(true);
        tx.bindings.push({ company: "company-new", target: target.targetId, secret: ref.secretId, path: ref.configPath });
      }
    }),
    syncEnvBindingsForTarget: vi.fn(async (
      _company: string, _target: unknown, _env: unknown, { db: tx }: { db: Transaction },
    ) => {
      assertExecutor(tx);
      calls.push("binding:env");
      failAt("env-binding");
    }),
  };
  const services = {
    getById: vi.fn(async () => row),
    hasUnresolvedPendingCleanupLeases: vi.fn(async () => false),
    create: vi.fn(async (data: Row, _unused: unknown, { db: tx }: { db: Transaction }) => {
      assertExecutor(tx);
      calls.push("row:create");
      failAt("row");
      return tx.row = { ...copy(data), id: "env" };
    }),
    update: vi.fn(async (_id: string, patch: Partial<Row>, { db: tx }: { db: Transaction }) => {
      assertExecutor(tx);
      calls.push("row:update");
      failAt("row");
      return tx.row = { ...tx.row!, ...copy(patch) };
    }),
  };
  const audit = vi.fn();
  const context = vm.createContext({
    db, svc: services, secrets, secretService: () => secrets,
    secretName: () => "synthetic-key", parseObject: (value: unknown) => value ?? {},
    sshEnvironmentConfigPersistenceSchema: { safeParse: (value: unknown) => ({ success: true, data: copy(value) }) },
    assertCanAccessInstanceEnvironments: vi.fn(), assertNoClientPlatformProvisionedMarkers: vi.fn(),
    assertPlatformProvisionedEnvironmentWritable: vi.fn(),
    resolveEnvironmentSecretContextCompanyId: async () => "company-new",
    getActorInfo: () => ({ actorType: "user", actorId: "synthetic-user" }),
    getConfiguredSecretProvider: () => "local_encrypted", strictSecretsMode: true, options: {},
    collectEnvironmentSecretRefs: async ({ environment }: { environment: Row }) => [
      { secretId: environment.config.privateKeySecretRef.secretId, configPath: "privateKeySecretRef" },
    ],
    customImages: { reconcileActiveTemplateForConfigChange: async () => ({ action: "none" }) },
    logInstanceEnvironmentActivity: audit, summarizeEnvironmentUpdate: () => ({}),
    presentEnvironmentForRead: (_req: unknown, value: unknown) => value,
  });
  vm.runInContext(executable, context, { timeout: 1000 });
  const req = {
    params: { companyId: "company-new", id: "env" },
    body: {
      ...(method === "POST" ? { name: "New", driver: "ssh" } : {}), envVars: {},
      config: { ...copy(existingConfig), privateKey: "SYNTHETIC-NON-CREDENTIAL",
        privateKeySecretRef: input === "existing-ref" ? reference(OLD) : null },
    },
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  let error: unknown;
  try {
    await context[method === "POST" ? "createRoute" : "updateRoute"](req, res);
  } catch (caught) {
    error = caught;
  }
  return { keys, row, bindings, before, calls, db, services, secrets, audit, res, error };
}

describe("SSH environment saves retain stored keys", () => {
  for (const method of ["POST", "PATCH"] as const) {
    for (const input of ["existing-ref", "ui-null-ref"] as const) {
      for (const failure of ["success", "row", "config-binding", "env-binding", "key-creation"] as const) {
        it(`${method} ${input}: ${failure}`, async () => {
          const result = await save(method, input, failure);
          expect(result.secrets.remove).not.toHaveBeenCalled();
          expect(result.keys.has(OLD)).toBe(true);
          expect(result.bindings).toContainEqual(result.before.bindings[0]);
          expect(result.secrets.create).toHaveBeenCalledOnce();
          const rowCall = method === "POST" ? result.services.create : result.services.update;

          if (failure === "key-creation") {
            expect((result.error as Error).message).toBe("synthetic-key-creation-failure");
            expect(result.keys.has(NEXT)).toBe(false);
            expect(result.db.transaction).not.toHaveBeenCalled();
            expect(rowCall).not.toHaveBeenCalled();
            expect(result.secrets.replaceSecretRefsForInstanceTarget).not.toHaveBeenCalled();
            expect(result.secrets.syncEnvBindingsForTarget).not.toHaveBeenCalled();
          } else {
            expect(result.keys.has(NEXT)).toBe(true);
            expect(result.db.transaction).toHaveBeenCalledOnce();
            expect(rowCall).toHaveBeenCalledOnce();
            expect(result.calls.slice(0, 3)).toEqual(["key:create", "transaction:start", `row:${method === "POST" ? "create" : "update"}`]);
            expect(result.secrets.replaceSecretRefsForInstanceTarget).toHaveBeenCalledTimes(failure === "row" ? 0 : 1);
            expect(result.secrets.syncEnvBindingsForTarget).toHaveBeenCalledTimes(["row", "config-binding"].includes(failure) ? 0 : 1);
          }
          if (failure === "success") {
            expect(result.error).toBeUndefined();
            expect(result.row?.config.privateKey).toBeNull();
            expect(result.row?.config.privateKeySecretRef).toEqual(reference(NEXT));
            expect(result.bindings.filter((binding) => binding.target === "env").map((binding) => binding.secret)).toEqual([NEXT]);
            expect(result.calls.at(-1)).toBe("transaction:commit");
            expect(result.res.json).toHaveBeenCalledOnce();
            expect(result.audit).toHaveBeenCalledOnce();
          } else {
            expect((result.error as Error).message).toBe(`synthetic-${failure}-failure`);
            // This is the mock's staged state, not evidence of real DB rollback.
            expect(result.row).toEqual(result.before.row);
            expect(result.bindings).toEqual(result.before.bindings);
            expect(result.bindings.some((binding) => binding.secret === NEXT)).toBe(false);
            if (failure !== "key-creation") expect(result.calls.at(-1)).toBe("transaction:rollback-model");
            expect(result.res.json).not.toHaveBeenCalled();
            expect(result.audit).not.toHaveBeenCalled();
          }
        });
      }
    }
  }
});
