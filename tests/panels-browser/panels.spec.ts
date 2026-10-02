import { test, expect, type Page, type Locator } from "@playwright/test";
import { skill } from "./fixtures";

const storageKey = "skillStudio.paneSizes";
async function width(panel: Locator) {
  return panel.evaluate((element) => element.getBoundingClientRect().width);
}
async function drag(page: Page, separator: Locator, delta: number) {
  const box = await separator.boundingBox();
  if (!box) throw new Error("Resize separator has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}
async function savedLayout(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), storageKey);
}

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket("**", async (socket) => {
    const url = new URL(socket.url());
    if (url.origin !== "ws://127.0.0.1:6138" || url.pathname !== "/") {
      await socket.close();
      throw new Error(`Unexpected isolated WebSocket blocked: ${url.origin}${url.pathname}`);
    }
    socket.connectToServer(); // Only the local fixture's Vite HMR connection.
  });
  // Deny every non-local request and every API mutation. Unexpected API reads
  // also fail, so the isolated browser cannot silently reach a provider/server.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:6138") {
      await route.abort("blockedbyclient");
      throw new Error(`External request blocked: ${url.origin}`);
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (route.request().method() !== "GET") {
      await route.abort("blockedbyclient");
      throw new Error(`API mutation blocked: ${route.request().method()} ${url.pathname}`);
    }
    let body: unknown;
    switch (url.pathname) {
      case "/api/auth/get-session": body = null; break;
      case "/api/companies": body = [{ id: "company-1", name: "Panel fixture", issuePrefix: "FIX", status: "active" }]; break;
      case "/api/companies/company-1/skills": body = [skill]; break;
      case "/api/companies/company-1/skills/source-skill": body = skill; break;
      case "/api/companies/company-1/skills/source-skill/files": body = { path: "SKILL.md", content: skill.markdown, markdown: true, editable: true, editableReason: null }; break;
      case "/api/companies/company-1/skills/source-skill/test-inputs":
      case "/api/companies/company-1/skills/source-skill/test-runs":
      case "/api/companies/company-1/skill-test-run-templates":
      case "/api/companies/company-1/agents":
      case "/api/adapters": body = []; break;
      default:
        await route.abort("blockedbyclient");
        throw new Error(`Unexpected isolated API read: ${url.pathname}`);
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/skills/studio/source-skill");
  await expect(page.locator('[data-panel][id="skill"]')).toBeVisible();
  await expect(page.getByRole("separator")).toHaveCount(2);
});

test("pointer resizing respects panel IDs, pixel bounds and collapse/expand", async ({ page }) => {
  const panels = { skill: page.locator('[data-panel][id="skill"]'), input: page.locator('[data-panel][id="input"]'), runs: page.locator('[data-panel][id="runs"]') };
  const handles = page.getByRole("separator");
  const before = await width(panels.skill);
  await drag(page, handles.nth(0), 80);
  await expect.poll(() => width(panels.skill)).toBeGreaterThan(before + 50);
  expect(await width(panels.input)).toBeGreaterThanOrEqual(239);
  const runsBefore = await width(panels.runs);
  await drag(page, handles.nth(1), -50);
  await expect.poll(() => width(panels.runs)).toBeGreaterThan(runsBefore + 30);
  await drag(page, handles.nth(1), -1000);
  await expect.poll(() => width(panels.input)).toBeLessThan(42);
  expect(await width(panels.input)).toBeGreaterThanOrEqual(39);
  await drag(page, handles.nth(1), 300);
  await expect.poll(() => width(panels.input)).toBeGreaterThanOrEqual(239);
  await drag(page, handles.nth(0), -1000);
  await expect.poll(() => width(panels.skill)).toBeGreaterThanOrEqual(279);
  expect(await width(panels.skill)).toBeLessThan(282);
  await drag(page, handles.nth(1), 2000);
  expect(await width(panels.runs)).toBeGreaterThanOrEqual(359);
});

test("keyboard resizing commits ID-keyed layout and restores it on reload and mobile remount", async ({ page }) => {
  const input = page.locator('[data-panel][id="input"]');
  const first = page.getByRole("separator").nth(0);
  const before = await width(page.locator('[data-panel][id="skill"]'));
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page.locator('[data-panel][id="skill"]'))).toBeGreaterThan(before);
  // End/Home must respect the pixel floors rather than grow beyond the group.
  await page.keyboard.press("Home");
  await expect.poll(() => width(page.locator('[data-panel][id="skill"]'))).toBeGreaterThanOrEqual(279);
  expect(await width(page.locator('[data-panel][id="skill"]'))).toBeLessThan(282);
  await page.keyboard.press("ArrowRight");
  await page.getByRole("separator").nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect.poll(() => width(input)).toBeLessThan(42);
  await page.keyboard.press("Enter");
  await expect.poll(() => width(input)).toBeGreaterThanOrEqual(239);
  await expect.poll(() => savedLayout(page)).toEqual(expect.objectContaining({ skill: expect.any(Number), input: expect.any(Number), runs: expect.any(Number) }));
  const saved = await savedLayout(page);
  expect(Object.keys(saved).sort()).toEqual(["input", "runs", "skill"]);
  const widths = await page.locator("[data-panel]").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  const total = widths.reduce((sum, value) => sum + value, 0);
  for (const [index, id] of ["skill", "input", "runs"].entries()) {
    expect(widths[index] / total * 100).toBeCloseTo(saved[id], 1);
  }
  // Persisted object key order must not determine physical panel order.
  await page.evaluate(({ key, layout }) => localStorage.setItem(key, JSON.stringify({ runs: layout.runs, input: layout.input, skill: layout.skill })), { key: storageKey, layout: saved });
  await page.reload();
  await expect(page.getByRole("separator")).toHaveCount(2);
  await expect.poll(async () => page.locator("[data-panel]").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().width))))
    .toEqual(widths.map(Math.round));
  expect(await savedLayout(page)).toEqual(saved);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.getByRole("separator")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Input", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("separator")).toHaveCount(2);
  await expect.poll(() => savedLayout(page)).toEqual(saved);
  await expect.poll(async () => page.locator("[data-panel]").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().width))))
    .toEqual(widths.map(Math.round));
  expect(await width(input)).toBeGreaterThanOrEqual(239);
});
