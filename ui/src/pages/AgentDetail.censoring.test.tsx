// @vitest-environment jsdom
import type { ReactNode } from "react";
import type { HeartbeatRun } from "@paperclipai/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { LatestRunCard } from "./AgentDetail";
import { LatestRunCard as ProductionLatestRunCard } from "./AgentDetail.production";

// Keep the actual card, QueryClient and MarkdownBody/react-markdown renderer.
// Only navigation, inert context and API boundaries are mocked.
vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ pathname: "/agents/synthetic-agent", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
  useCaseHref: () => (id: string) => `/cases/${id}`,
}));
vi.mock("../context/ThemeContext", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../context/CompanyContext", () => ({
  useOptionalCompany: () => null,
  useCompany: () => ({ selectedCompanyId: "synthetic-company" }),
}));
vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: { getGeneral: vi.fn(async () => ({})) },
}));
vi.mock("../api/issues", () => ({ issuesApi: { get: vi.fn() } }));
vi.mock("../adapters", () => ({ getUIAdapter: () => null, onAdapterChange: () => () => {}, buildTranscript: () => [] }));

describe.each([
  ["streamlined", LatestRunCard],
  ["production", ProductionLatestRunCard],
] as const)("%s run summary path censoring", (_name, Card) => {
  function renderSummary(summary: string, setting: boolean | undefined) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
    if (setting !== undefined) client.setQueryData(queryKeys.instance.generalSettings, { censorUsernameInLogs: setting });
    const run = {
      id: "synthetic-run", agentId: "synthetic-agent", companyId: "synthetic-company",
      status: "succeeded", createdAt: "2026-01-01T00:00:00Z", invocationSource: "on_demand",
      resultJson: { summary }, contextSnapshot: null, error: null,
    } as unknown as HeartbeatRun;
    const before = JSON.stringify(run);
    try {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <Card runs={[run]} agentId="synthetic-agent" issuesById={new Map()} />
        </QueryClientProvider>,
      );
      expect(JSON.stringify(run)).toBe(before);
      const container = document.createElement("div");
      container.innerHTML = html;
      return container;
    } finally { client.clear(); }
  }

  it.each([true, false, undefined])("keeps real inline code and emphasis with setting %s", (setting) => {
    const container = renderSummary("Home `/Users/sampleuser` remains **code**", setting);
    expect(container.querySelector("code")?.textContent).toBe(setting === true ? "/Users/s*********" : "/Users/sampleuser");
    expect(container.querySelector("strong")?.textContent).toBe("code");
    expect(container.textContent).not.toContain("`");
  });

  it.each([true, false, undefined])("keeps real link structure and masks its path target with setting %s", (setting) => {
    const container = renderSummary("See [home](/Users/sampleuser) for details", setting);
    const link = [...container.querySelectorAll("a")].find(node => node.textContent === "home");
    expect(link?.getAttribute("href")).toBe(setting === true ? "/Users/s*********" : "/Users/sampleuser");
    expect(container.textContent).toContain("See home for details");
  });

  it("preserves standalone names and role prose", () => {
    const prose = "sampleuser works with Sample User; analyst role unchanged";
    expect(renderSummary(prose, true).textContent).toContain(prose);
  });
});
