// @vitest-environment jsdom

import { act, forwardRef, useImperativeHandle, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardChat } from "./BoardChat";

const state = vi.hoisted(() => ({ companyId: "company-a" }));
const setBreadcrumbs = vi.hoisted(() => vi.fn());
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({
  selectedCompanyId: state.companyId,
  selectedCompany: { id: state.companyId, name: state.companyId },
}) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs }) }));
vi.mock("../context/DialogContext", () => ({ useDialogState: () => ({ onboardingOpen: false }) }));
vi.mock("../api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("../api/goals", () => ({ goalsApi: { list: async () => [] } }));
vi.mock("../api/issues", () => ({ issuesApi: { list: async () => [], listComments: async () => [], listFeedbackVotes: async () => [] } }));
vi.mock("../components/ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("../components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../components/WorkHarborBrand", () => ({ WorkHarborMark: () => null }));
vi.mock("../components/AgentIconPicker", () => ({ AgentIcon: () => null }));
vi.mock("../components/AgentBubbleActionRow", () => ({ AgentBubbleActionRow: () => null, agentBubbleDateLabel: () => "" }));
vi.mock("../components/ChatComposer", () => ({
  ChatComposer: forwardRef<{ focus: () => void }, { value: string; onChange: (value: string) => void; onSubmit: () => void; disabled: boolean }>((props, ref) => {
    useImperativeHandle(ref, () => ({ focus: () => {} }));
    return <><textarea aria-label="draft" value={props.value} onChange={(event) => props.onChange(event.target.value)} /><button onClick={props.onSubmit} disabled={props.disabled}>Submit fixture</button></>;
  }),
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ children }: { children: ReactNode }) => <button>{children}</button> }));
vi.mock("@/components/ui/avatar", () => ({ Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>, AvatarFallback: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>, TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>, TooltipContent: () => null }));
vi.mock("@/components/ui/sheet", () => ({ Sheet: ({ children }: { children: ReactNode }) => <>{children}</>, SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>, SheetContent: () => null }));
vi.mock("lucide-react", () => ({ Activity: () => null, ArrowDown: () => null, History: () => null, MessageSquarePlus: () => null, X: () => null }));
vi.mock("../lib/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" "), formatDateTime: String }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  state.companyId = "company-a";
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("ignores an old company's delayed stream and preserves the new company's send state", async () => {
  const oldRead = deferred<ReadableStreamReadResult<Uint8Array>>();
  const oldEnd = deferred<ReadableStreamReadResult<Uint8Array>>();
  const newRead = deferred<ReadableStreamReadResult<Uint8Array>>();
  const oldReader = { read: vi.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(oldEnd.promise) };
  const newReader = { read: vi.fn().mockReturnValueOnce(newRead.promise).mockResolvedValue({ done: true }) };
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>()
    .mockResolvedValueOnce({ ok: true, body: { getReader: () => oldReader } })
    .mockResolvedValueOnce({ ok: true, body: { getReader: () => newReader } });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = () => root.render(<QueryClientProvider client={client}><BoardChat /></QueryClientProvider>);
  const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); };
  const send = async (text: string) => {
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Submit fixture")!.click();
    });
    await settle();
  };
  try {
    await act(async () => render());
    await settle();
    await send("Message from A");
    expect(oldReader.read).toHaveBeenCalledOnce();
    state.companyId = "company-b";
    await act(async () => render());
    await settle();
    await send("Message from B");
    expect(newReader.read).toHaveBeenCalledOnce();
    await act(async () => oldRead.resolve({ done: false, value: new TextEncoder().encode('data: {"type":"chunk","text":"Old company secret"}\n') }));
    await settle();
    expect(host.textContent).not.toContain("Old company secret");
    await act(async () => oldEnd.resolve({ done: true, value: undefined }));
    await settle();
    const submit = [...host.querySelectorAll("button")].find((button) => button.textContent === "Submit fixture")!;
    expect(submit.disabled).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
    await act(async () => newRead.resolve({ done: true, value: undefined }));
    await settle();
    expect(submit.disabled).toBe(false);
  } finally {
    oldRead.resolve({ done: true, value: undefined });
    oldEnd.resolve({ done: true, value: undefined });
    newRead.resolve({ done: true, value: undefined });
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});

it("aborts a pending fetch on unmount and ignores its late response", async () => {
  const response = deferred<unknown>();
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>().mockReturnValue(response.promise);
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let mounted = true;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><BoardChat /></QueryClientProvider>));
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Pending message");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Submit fixture")!.click());
    expect(fetchMock).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    await act(async () => root.unmount());
    mounted = false;
    expect(signal.aborted).toBe(true);
    const getReader = vi.fn();
    await act(async () => response.resolve({ ok: true, body: { getReader } }));
    expect(getReader).not.toHaveBeenCalled();
  } finally {
    response.resolve({ ok: false });
    if (mounted) await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});

it("still reports an active company's fetch failure and enables retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Fixture connection failed")));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><BoardChat /></QueryClientProvider>));
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Failed message");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Submit fixture")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The board assistant is unavailable right now.");
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Submit fixture")!.disabled).toBe(false);
    expect(error).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});
