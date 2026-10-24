import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./execute.js";

const { runProcess } = vi.hoisted(() => ({ runProcess: vi.fn() }));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<
    typeof import("@paperclipai/adapter-utils/execution-target")
  >("@paperclipai/adapter-utils/execution-target");
  return {
    ...actual,
    ensureAdapterExecutionTargetRuntimeCommandInstalled: vi.fn(),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(),
    resolveAdapterExecutionTargetCommandForLogs: async (command: string) =>
      command,
    runAdapterExecutionTargetProcess: runProcess,
  };
});

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@paperclipai/adapter-utils/server-utils")
  >("@paperclipai/adapter-utils/server-utils");
  return {
    ...actual,
    ensureAbsoluteDirectory: vi.fn(),
    readPaperclipRuntimeSkillEntries: async () => [],
  };
});

vi.mock("./remote-command.js", () => ({
  prepareCursorSandboxCommand: async (input: {
    command: string;
    env: Record<string, string>;
  }) => ({
    command: input.command,
    env: input.env,
    remoteSystemHomeDir: null,
    addedPathEntry: null,
    preferredCommandPath: null,
  }),
}));

const cwd = "/workharbor-session-fixture";
const previousSession = "previous-session";
const success = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: "",
  stderr: "",
};
const unknownSession = {
  ...success,
  exitCode: 1,
  stderr: "unknown session previous-session",
};
const replacement = {
  ...success,
  stdout: JSON.stringify({
    type: "result",
    session_id: "replacement-session",
    result: "ok",
  }),
};

async function runWithSession(
  options: {
    savedCwd?: string;
    savedRemote?: Record<string, unknown>;
  } = {},
) {
  return execute({
    runId: "session-fixture",
    agent: {
      id: "agent-fixture",
      companyId: "company-fixture",
      name: "Fixture",
      adapterType: "cursor",
      adapterConfig: {},
    },
    runtime: {
      sessionId: previousSession,
      sessionParams: {
        sessionId: previousSession,
        cwd: options.savedCwd ?? cwd,
        ...(options.savedRemote
          ? { remoteExecution: options.savedRemote }
          : {}),
      },
      sessionDisplayId: previousSession,
      taskKey: null,
    },
    config: { command: "fake-cursor", cwd, model: "auto" },
    context: {},
    onLog: async () => {},
  });
}

function expectNoSavedSession(result: Awaited<ReturnType<typeof execute>>) {
  expect(result.sessionId).toBeNull();
  expect(result.sessionParams).toBeNull();
  expect(result.sessionDisplayId).toBeNull();
}

function expectResumeArgs(expected: boolean[]) {
  expect(runProcess).toHaveBeenCalledTimes(expected.length);
  expected.forEach((resume, index) => {
    expect(runProcess.mock.calls[index][3].includes("--resume")).toBe(resume);
  });
}

beforeEach(() => runProcess.mockReset());

describe("Cursor session fallback", () => {
  it("clears an unknown session when the fresh retry emits no replacement ID", async () => {
    runProcess
      .mockResolvedValueOnce(unknownSession)
      .mockResolvedValueOnce(success);
    const result = await runWithSession();
    expectResumeArgs([true, false]);
    expectNoSavedSession(result);
    expect(result.clearSession).toBe(true);
  });

  it("does not rebind a rejected working-directory session to the new directory", async () => {
    runProcess.mockResolvedValueOnce(success);
    const result = await runWithSession({ savedCwd: "/different-workspace" });
    expectResumeArgs([false]);
    expectNoSavedSession(result);
  });

  it("does not retain a remote session when starting a local run", async () => {
    runProcess.mockResolvedValueOnce(success);
    const result = await runWithSession({
      savedRemote: { transport: "sandbox", leaseId: "previous-lease" },
    });
    expectResumeArgs([false]);
    expectNoSavedSession(result);
  });

  it("retains an admitted resumed session if no explicit ID is emitted", async () => {
    runProcess.mockResolvedValueOnce(success);
    const result = await runWithSession();
    expectResumeArgs([true]);
    expect(result.sessionId).toBe(previousSession);
    expect(result.clearSession).toBe(false);
  });

  it("uses the replacement session emitted by a fresh retry", async () => {
    runProcess
      .mockResolvedValueOnce(unknownSession)
      .mockResolvedValueOnce(replacement);
    const result = await runWithSession();
    expectResumeArgs([true, false]);
    expect(result.sessionId).toBe("replacement-session");
    expect(result.clearSession).toBe(false);
  });

  it("uses an explicit fresh session after a directory mismatch", async () => {
    runProcess.mockResolvedValueOnce(replacement);
    const result = await runWithSession({ savedCwd: "/different-workspace" });
    expectResumeArgs([false]);
    expect(result.sessionId).toBe("replacement-session");
    expect(result.sessionParams).toMatchObject({
      sessionId: "replacement-session",
      cwd,
    });
  });
});
