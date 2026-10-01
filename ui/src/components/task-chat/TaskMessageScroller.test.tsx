// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskMessageScroller } from "./TaskMessageScroller";
import { TaskChatScrollNavigation, useTaskChatScrollNavigation } from "./scroll-navigation";

const PILL_SELECTOR = 'button[aria-label="Scroll to latest"]';

/** The mobile owner records window positions in the same history entry. */
function MobileHistoryPosition({ enabled }: { enabled: boolean }) {
  const navigation = useTaskChatScrollNavigation();
  useLayoutEffect(() => {
    if (enabled) navigation.remember(777, null);
  }, [enabled, navigation.key, navigation.hash]);
  return null;
}

/**
 * jsdom has no layout, so scroll geometry is faked per element: scrollHeight /
 * clientHeight are pinned and scrollTop is backed by a plain variable.
 */
function fakeGeometry(el: HTMLElement, { scrollHeight = 1000, clientHeight = 400 } = {}) {
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
    configurable: true,
  });
}

function fakeResizableGeometry(
  el: HTMLElement,
  { scrollHeight = 1000, clientHeight = 400 } = {},
) {
  let currentClientHeight = clientHeight;
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => currentClientHeight,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
    configurable: true,
  });
  return {
    setClientHeight(value: number) {
      currentClientHeight = value;
    },
  };
}

/**
 * Scroll/wheel are continuous-priority events, so React flushes the resulting
 * state updates asynchronously — wait a macrotask after dispatching.
 */
function flushEvents() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve);
  });
}

describe("TaskMessageScroller", () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(contentKey: unknown = 0) {
    flushSync(() => {
      root.render(
        <TaskMessageScroller contentKey={contentKey}>
          <div>messages</div>
        </TaskMessageScroller>,
      );
    });
  }

  function scroller(): HTMLDivElement {
    return container.querySelector<HTMLDivElement>('[data-testid="task-chat-scroller"]')!;
  }

  function pill(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(PILL_SELECTOR);
  }

  /**
   * Wait for the pill to reach a state, rather than for a fixed number of turns.
   * `flushEvents` yields exactly one macrotask, which is enough on an idle
   * machine and not when the suite runs many workers in parallel — React
   * flushes continuous-priority updates asynchronously, so the DOM read can
   * land before the state does. Sites that dereference `pill()!` turn that into
   * a hard failure rather than a retry.
   */
  async function waitForPill(present: boolean): Promise<void> {
    await vi.waitFor(() =>
      present ? expect(pill()).not.toBeNull() : expect(pill()).toBeNull(),
    );
  }

  /** Set scrollTop and fire a scroll event, like a user or the browser would. */
  async function scrollTo(el: HTMLElement, top: number) {
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    await flushEvents();
  }

  async function dispatch(el: HTMLElement, event: Event) {
    el.dispatchEvent(event);
    await flushEvents();
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    document.documentElement.style.removeProperty("--motion-scrollbar-idle-delay");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("applies same-task hash changes and restores each history entry without remounting", async () => {
    let initialized = false;
    function navigate(key: string, hash: string, restore = false) {
      flushSync(() => root.render(
        <TaskChatScrollNavigation.Provider value={{ key, hash, restore }}>
          <TaskMessageScroller contentKey="unchanged">
            <div ref={(node) => {
              if (node && !initialized) {
                fakeGeometry(node.parentElement!);
                initialized = true;
              }
            }}>
              {[100, 500].map((top, index) => <div key={index} id={`nav-comment-${index}`} data-thread-anchor={`nav-comment-${index}`} ref={(node) => {
                if (node) node.getBoundingClientRect = () => ({ top: top - scroller().scrollTop, bottom: top + 100 - scroller().scrollTop, height: 100 } as DOMRect);
              }}>Comment {index}</div>)}
            </div>
          </TaskMessageScroller>
        </TaskChatScrollNavigation.Provider>,
      ));
    }
    navigate("desktop-entry-one", "#nav-comment-0");
    const viewport = scroller();
    expect(viewport.scrollTop).toBe(100);
    await scrollTo(viewport, 150);
    navigate("desktop-entry-two", "#nav-comment-1");
    expect(scroller()).toBe(viewport);
    expect(viewport.scrollTop).toBe(500);
    navigate("desktop-entry-one", "#nav-comment-0", true);
    expect(viewport.scrollTop).toBe(150);
    navigate("desktop-entry-one", "#nav-comment-1", true);
    expect(viewport.scrollTop).toBe(500);
  });

  it("renders children inside the scroll container, pill hidden, scrolled to bottom on mount", () => {
    render();
    const el = scroller();
    expect(el.textContent).toContain("messages");
    expect(pill()).toBeNull();
    // Mount effect pins to the bottom.
    expect(el.scrollTop).toBe(el.scrollHeight);
  });

  it("keeps inactive content in document flow without desktop observers or scroll writes", () => {
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      disconnect() {}
    });
    function renderInactive(contentKey: number) {
      flushSync(() => root.render(
        <TaskMessageScroller scroll={false} contentKey={contentKey}>
          <div>messages</div>
        </TaskMessageScroller>,
      ));
    }
    renderInactive(1);
    const el = scroller();
    fakeGeometry(el);
    el.scrollTop = 123;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    renderInactive(2);
    expect(el.scrollTop).toBe(123);
    expect(observe).not.toHaveBeenCalled();
    expect(el.classList).not.toContain("absolute");
    expect(el.classList).not.toContain("overflow-y-auto");
    expect(el.parentElement?.classList).not.toContain("flex-1");
    expect(el.getAttribute("data-scroll-active")).toBeNull();
    expect(pill()).toBeNull();
  });

  it.each([false, true])("preserves its child and desktop navigation position while inactive, then reactivates cleanly (restore=%s)", async (restore) => {
    document.documentElement.style.setProperty("--motion-scrollbar-idle-delay", "600ms");
    let initialized = false;
    function changeMode(scroll: boolean, contentKey: number) {
      flushSync(() => root.render(
        <TaskChatScrollNavigation.Provider value={{ key: `mode-switch-entry-${restore}`, hash: "", restore }}>
          <TaskMessageScroller scroll={scroll} contentKey={contentKey}>
            <div ref={(node) => {
              if (node && !initialized) {
                fakeGeometry(node.parentElement!);
                initialized = true;
              }
            }}>messages</div>
          </TaskMessageScroller>
        </TaskChatScrollNavigation.Provider>,
      ));
    }
    changeMode(true, 1);
    const el = scroller();
    const child = el.firstElementChild;
    await scrollTo(el, 150);
    await waitForPill(true);
    expect(el.getAttribute("data-scroll-active")).toBe("true");

    changeMode(false, 2);
    expect(scroller()).toBe(el);
    expect(el.firstElementChild).toBe(child);
    expect(el.getAttribute("data-scroll-active")).toBeNull();
    expect(pill()).toBeNull();
    await scrollTo(el, 777);
    changeMode(false, 3);
    expect(el.scrollTop).toBe(777);
    expect(pill()).toBeNull();

    changeMode(true, 4);
    expect(scroller()).toBe(el);
    expect(el.firstElementChild).toBe(child);
    // Inactive events must not overwrite the saved desktop history entry.
    expect(el.scrollTop).toBe(150);
    expect(el.getAttribute("data-scroll-active")).toBeNull();
    await scrollTo(el, 200);
    await waitForPill(true);
    expect(el.getAttribute("data-scroll-active")).toBe("true");
  });

  it.each([false, true])("restores the desktop reading anchor after mobile history updates (restore=%s)", async (restore) => {
    let initialized = false;
    let rowOffset = 0;
    function changeMode(scroll: boolean) {
      flushSync(() => root.render(
        <TaskChatScrollNavigation.Provider value={{ key: `mode-anchor-entry-${restore}`, hash: "", restore }}>
          <MobileHistoryPosition enabled={!scroll} />
          <TaskMessageScroller scroll={scroll} contentKey={rowOffset}>
            <div data-thread-anchor="reading-row" ref={(node) => {
              if (!node) return;
              const viewport = node.parentElement!;
              if (!initialized) {
                fakeGeometry(viewport);
                viewport.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400 } as DOMRect);
                initialized = true;
              }
              node.getBoundingClientRect = () => ({
                top: 300 + rowOffset - viewport.scrollTop,
                bottom: 400 + rowOffset - viewport.scrollTop,
                height: 100,
              } as DOMRect);
            }}>reading row</div>
          </TaskMessageScroller>
        </TaskChatScrollNavigation.Provider>,
      ));
    }
    changeMode(true);
    const el = scroller();
    await scrollTo(el, 150);
    await waitForPill(true);
    changeMode(false);
    await scrollTo(el, 777);
    // New material above the reading row must not displace it on desktop.
    rowOffset = 200;
    changeMode(true);
    expect(scroller()).toBe(el);
    expect(el.scrollTop).toBe(350);
    expect(el.firstElementChild?.getBoundingClientRect().top).toBe(150);
    expect(pill()).not.toBeNull();
  });

  it("extends only the streamlined scroll box through the page gutter", () => {
    render();
    const el = scroller();
    const frame = el.parentElement;

    expect(frame?.className).toBe("relative min-h-0 flex-1");
    expect(el.classList).toContain("-right-4");
    expect(el.classList).toContain("pr-4");
    expect(el.classList).toContain("md:-right-6");
    expect(el.classList).toContain("md:pr-6");
    expect(el.classList).not.toContain("right-0");
  });

  it("shows the scrollbar only while scroll activity is recent", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--motion-scrollbar-idle-delay", "600ms");
    render();
    const el = scroller();
    fakeGeometry(el);

    expect(el.className).toContain("scrollbar-while-scrolling");
    expect(el.getAttribute("data-scroll-active")).toBeNull();

    el.scrollTop = 100;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(el.getAttribute("data-scroll-active")).toBe("true");

    vi.advanceTimersByTime(599);
    expect(el.getAttribute("data-scroll-active")).toBe("true");
    vi.advanceTimersByTime(1);
    expect(el.getAttribute("data-scroll-active")).toBeNull();
  });

  it("contains horizontal overflow so no scrollbar appears above the composer", () => {
    render();

    expect(scroller().classList).toContain("overflow-x-hidden");
    expect(scroller().classList).toContain("overflow-y-auto");
  });

  it("auto-follows content instantly while pinned", async () => {
    render(1);
    const el = scroller();
    fakeGeometry(el);
    await scrollTo(el, 600); // bottom: 1000 - 600 - 400 = 0 → pinned
    await waitForPill(false); // pinned state settled before content grows
    render(2);
    expect(el.scrollTop).toBe(1000);
    expect(pill()).toBeNull();
  });

  it("holds position and shows the icon-only pill when scrolled up", async () => {
    render(1);
    const el = scroller();
    fakeGeometry(el);
    await scrollTo(el, 100); // 500px from bottom → unpinned
    await waitForPill(true);
    const btn = pill();
    expect(btn).not.toBeNull();
    expect(btn!.className).toContain("tc-scroll-pill-in");
    expect(btn!.className).toContain("size-8");
    expect(btn!.className).toContain("bottom-7");
    expect(btn!.className).not.toContain("bottom-3");
    expect(btn!.className).not.toContain("-translate-x-1/2");
    // Icon-only: no visible text.
    expect(btn!.textContent).toBe("");
    // New content must not yank the held position.
    render(2);
    expect(el.scrollTop).toBe(100);
  });

  it("follows a shrinking viewport while pinned so a growing composer cannot cover the latest text", async () => {
    let triggerResize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          triggerResize = () =>
            callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    render();
    const el = scroller();
    const geometry = fakeResizableGeometry(el);
    triggerResize();
    await scrollTo(el, 600);

    geometry.setClientHeight(200);
    triggerResize();

    expect(el.scrollTop).toBe(el.scrollHeight);
    expect(pill()).toBeNull();
  });

  it("holds a reader's position when the composer grows while they are scrolled up", async () => {
    let triggerResize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          triggerResize = () =>
            callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    render();
    const el = scroller();
    const geometry = fakeResizableGeometry(el);
    triggerResize();
    await scrollTo(el, 100);
    await waitForPill(true);

    geometry.setClientHeight(200);
    triggerResize();

    expect(el.scrollTop).toBe(100);
    expect(pill()).not.toBeNull();
  });

  it("small drifts within the pin threshold do not show the pill", async () => {
    render();
    const el = scroller();
    fakeGeometry(el);
    await scrollTo(el, 560); // 40px from bottom, threshold is 48
    expect(pill()).toBeNull();
  });

  it("clicking the pill smooth-scrolls, ignores intermediate scroll events, re-pins on arrival", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    render(1);
    const el = scroller();
    fakeGeometry(el);
    const scrollToSpy = vi.fn();
    el.scrollTo = scrollToSpy as unknown as typeof el.scrollTo;

    await scrollTo(el, 100);
    await waitForPill(true);
    const btn = pill()!;
    btn.click();
    await flushEvents();
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });

    // Intermediate glide positions fire scroll events; they must not unpin
    // (i.e. the easing flag swallows them and the pill state stays put).
    await scrollTo(el, 250);
    await scrollTo(el, 400);
    expect(pill()).not.toBeNull();

    // Arrival within the threshold re-pins and hides the pill (immediately
    // here: no matchMedia in jsdom → reduced-motion/unmount-now path).
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    await scrollTo(el, 600);
    expect(pill()).toBeNull();

    // Re-pinned: content growth follows instantly again.
    render(2);
    expect(el.scrollTop).toBe(1000);
  });

  it("finishes following at the new bottom when content changes during the latest glide", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    render(1);
    const el = scroller();
    fakeGeometry(el);
    el.scrollTo = vi.fn() as unknown as typeof el.scrollTo;
    await scrollTo(el, 100);
    await waitForPill(true);
    pill()!.click();
    await flushEvents();
    await scrollTo(el, 250);
    render(2);
    expect(el.scrollTop).toBe(1000);
  });

  it("a wheel gesture during the glide cancels easing and stays unpinned", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    render(1);
    const el = scroller();
    fakeGeometry(el);
    el.scrollTo = vi.fn() as unknown as typeof el.scrollTo;

    await scrollTo(el, 100);
    await waitForPill(true);
    pill()!.click();
    await flushEvents();
    await dispatch(el, new Event("wheel", { bubbles: true }));

    // Easing cancelled → user is unpinned, pill visible, content holds.
    expect(pill()).not.toBeNull();
    render(2);
    expect(el.scrollTop).toBe(100);

    // Scroll events far from the bottom now behave normally (still unpinned).
    await scrollTo(el, 200);
    expect(pill()).not.toBeNull();
  });

  it("plays the exit animation before unmounting when motion is enabled", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false }), // motion allowed
    );
    render();
    const el = scroller();
    fakeGeometry(el);
    await scrollTo(el, 100);
    await vi.waitFor(() => expect(pill()?.className).toContain("tc-scroll-pill-in"));

    // Scrolling back to the bottom starts the exit animation but keeps the
    // pill mounted until animationend.
    await scrollTo(el, 600);
    await vi.waitFor(() => expect(pill()?.className).toContain("tc-scroll-pill-out"));
    const exiting = pill();
    expect(exiting).not.toBeNull();

    // jsdom has no window.AnimationEvent, so React's vendor-prefix detection
    // maps onAnimationEnd to "webkitAnimationEnd" here (real browsers get the
    // unprefixed event).
    await dispatch(exiting!, new Event("webkitAnimationEnd", { bubbles: true }));
    await waitForPill(false);
  });

  it("unmounts immediately on hide under prefers-reduced-motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }), // reduce
    );
    render();
    const el = scroller();
    fakeGeometry(el);
    await scrollTo(el, 100);
    await waitForPill(true);
    await scrollTo(el, 600);
    await waitForPill(false); // no animationend needed
  });
});
