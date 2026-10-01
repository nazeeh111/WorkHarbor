// @vitest-environment jsdom

import { act, forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: forwardRef<
    { focus: () => void },
    { value: string; onChange: (value: string) => void }
  >(function MarkdownEditorMock(props, ref) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({
      focus: () => taRef.current?.focus(),
    }));
    return (
      <textarea
        ref={taRef}
        data-testid="multiline-md-mock"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    );
  }),
}));

vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: ReactNode }) => (
    <div data-testid="multiline-md-preview">{children}</div>
  ),
}));

import { InlineEditor, queueContainedBlurCommit } from "./InlineEditor";

/** Enter multiline edit mode by clicking the preview surface. */
function enterMultilineEdit(container: HTMLDivElement) {
  const preview = container.querySelector<HTMLDivElement>('[data-testid="multiline-md-preview"]');
  if (preview) {
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Lets React detect a DOM value change on controlled textareas (see React #10140). */
function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  const previous = textarea.value;
  valueSetter?.call(textarea, value);
  const tracker = (textarea as HTMLTextAreaElement & { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  tracker?.setValue(previous);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Matches `queueContainedBlurCommit` (double rAF before commit). Microtasks alone do not run these. */
function flushDoubleRequestAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

describe("InlineEditor", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("calls onSave with empty string when nullable and the field is cleared (single-line)", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="hello" nullable onSave={onSave} />);
    });

    const display = container.querySelector("span");
    expect(display).not.toBeNull();
    expect(display?.textContent).toBe("hello");

    act(() => {
      display!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    act(() => {
      setNativeTextareaValue(textarea!, "");
    });
    act(() => {
      textarea!.blur();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("");

    act(() => {
      root.unmount();
    });
  });

  it("does not call onSave when nullable is false/omitted and the field is cleared", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="hello" onSave={onSave} />);
    });

    const display = container.querySelector("span");
    expect(display).not.toBeNull();

    act(() => {
      display!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    act(() => {
      setNativeTextareaValue(textarea!, "");
    });
    act(() => {
      textarea!.blur();
    });

    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("multiline nullable clear uses autosave path (shows Saved after blur)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    act(() => {
      root.render(<InlineEditor value="hello" multiline nullable onSave={onSave} />);
    });

    // Non-empty value renders MarkdownBody preview; click to enter edit mode.
    act(() => {
      enterMultilineEdit(container);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="multiline-md-mock"]');
    expect(textarea).not.toBeNull();

    act(() => {
      textarea!.focus();
    });
    act(() => {
      setNativeTextareaValue(textarea!, "");
    });
    act(() => {
      outside.focus();
    });
    await act(async () => {
      await flushDoubleRequestAnimationFrame();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("");
    expect(container.textContent).toContain("Saved");

    act(() => {
      root.unmount();
    });
    outside.remove();
  });

  it("multiline defaults to MarkdownBody preview when value is non-empty, swaps to editor on click", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="Hello world" multiline onSave={onSave} />);
    });

    expect(container.querySelector('[data-testid="multiline-md-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="multiline-md-mock"]')).toBeNull();

    act(() => {
      enterMultilineEdit(container);
    });

    expect(container.querySelector('[data-testid="multiline-md-mock"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="multiline-md-preview"]')).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("marks multiline preview textboxes as multiline", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="Hello world" multiline onSave={onSave} />);
    });

    const preview = container.querySelector<HTMLElement>('[role="textbox"]');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("aria-multiline")).toBe("true");
    expect(preview?.tabIndex).toBe(0);

    act(() => {
      root.unmount();
    });
  });

  it("enters multiline edit mode from the keyboard preview surface", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="Hello world" multiline onSave={onSave} />);
    });

    const preview = container.querySelector<HTMLElement>('[role="textbox"]');
    expect(preview).not.toBeNull();

    act(() => {
      preview!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(container.querySelector('[data-testid="multiline-md-mock"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="multiline-md-preview"]')).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("syncs a new multiline value while focused when the user has not edited locally", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="" multiline onSave={onSave} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="multiline-md-mock"]');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe("");

    act(() => {
      textarea!.focus();
    });

    act(() => {
      root.render(<InlineEditor value="Loaded description" multiline onSave={onSave} />);
    });

    expect(textarea?.value).toBe("Loaded description");

    act(() => {
      root.unmount();
    });
  });

  it("preserves focused multiline local edits when the prop value changes underneath them", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);

    act(() => {
      root.render(<InlineEditor value="Original" multiline onSave={onSave} />);
    });

    // Non-empty value renders MarkdownBody preview; click to enter edit mode.
    act(() => {
      enterMultilineEdit(container);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="multiline-md-mock"]');
    expect(textarea).not.toBeNull();

    act(() => {
      textarea!.focus();
    });
    act(() => {
      setNativeTextareaValue(textarea!, "Local draft");
    });

    act(() => {
      root.render(<InlineEditor value="Remote update" multiline onSave={onSave} />);
    });

    expect(textarea?.value).toBe("Local draft");

    act(() => {
      root.unmount();
    });
  });
});

describe("InlineEditor save recovery", () => {
  let container: HTMLDivElement;
  let outside: HTMLButtonElement;
  let root: ReturnType<typeof createRoot>;

  function deferredSave() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  }

  function render(onSave: (value: string) => Promise<void>, value = "Original") {
    act(() => root.render(<InlineEditor value={value} multiline defaultEditing onSave={onSave} />));
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => input.focus());
    return input;
  }

  async function advance(time: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(time); });
  }

  function retryButton() {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Retry save");
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    container = document.body.appendChild(document.createElement("div"));
    outside = document.body.appendChild(document.createElement("button"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    outside.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("retains a rejected multiline draft and retries only on request (blur=%s)", async (blur) => {
    const request = deferredSave();
    const onSave = vi.fn().mockImplementationOnce(() => request.promise).mockResolvedValue(undefined);
    const input = render(onSave);
    act(() => setNativeTextareaValue(input, "Recoverable draft"));
    if (blur) act(() => outside.focus());
    await advance(blur ? 32 : 900);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Recoverable draft");
    await act(async () => {
      request.reject(new Error("Save rejected"));
      await Promise.resolve();
    });

    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Recoverable draft");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(retryButton()).toBeDefined();
    await advance(5000);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("Recoverable draft");

    await act(async () => { retryButton()!.click(); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("Recoverable draft");
    expect(container.textContent).toContain("Saved");
  });

  it("keeps a blurred draft editable throughout the delayed saving indicator", async () => {
    const request = deferredSave();
    const onSave = vi.fn(() => request.promise);
    const input = render(onSave);
    act(() => setNativeTextareaValue(input, "Pending blurred draft"));
    act(() => outside.focus());
    await advance(32);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Pending blurred draft");
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Pending blurred draft");
    await advance(100);
    expect(container.querySelector("textarea")).toBe(input);
    await act(async () => { request.resolve(); });
    expect(container.textContent).toContain("Saved");
    await advance(1600);
    expect(container.textContent).toContain("Pending blurred draft");
  });

  it("does not retry when a pending save fails before a queued blur runs", async () => {
    const request = deferredSave();
    const onSave = vi.fn().mockImplementationOnce(() => request.promise).mockResolvedValue(undefined);
    const input = render(onSave);
    act(() => setNativeTextareaValue(input, "Failed before blur"));
    await advance(900);
    act(() => outside.focus());
    await act(async () => { request.reject(new Error("Save rejected before blur")); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    await advance(5000);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Failed before blur");
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Failed before blur");
  });

  it.each([false, true])("keeps newer edits when an in-flight request settles, including after blur (reject=%s)", async (reject) => {
    const request = deferredSave();
    const onSave = vi.fn().mockImplementationOnce(() => request.promise).mockResolvedValue(undefined);
    function ControlledEditor() {
      const [value, setValue] = useState("Original");
      return <InlineEditor value={value} multiline defaultEditing onSave={async (next) => {
        await onSave(next);
        setValue(next);
      }} />;
    }
    act(() => root.render(<ControlledEditor />));
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      input.focus();
      setNativeTextareaValue(input, "First draft");
    });
    await advance(900);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("First draft");
    act(() => setNativeTextareaValue(input, "Newest draft"));
    act(() => outside.focus());
    await advance(32);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Newest draft");
    await act(async () => {
      if (reject) request.reject(new Error("Earlier save rejected"));
      else request.resolve();
      await Promise.resolve();
    });
    expect(input.value).toBe("Newest draft");
    if (reject) {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
      await advance(5000);
      expect(onSave).toHaveBeenCalledTimes(1);
      await act(async () => { retryButton()!.click(); });
    } else {
      await advance(900);
    }
    expect(onSave.mock.calls.map(([value]) => value)).toEqual(["First draft", "Newest draft"]);
    await advance(5000);
    expect(container.textContent).toContain("Newest draft");
    expect(container.textContent).not.toContain("First draft");
  });

  it("preserves an intentional revert to the original value during an in-flight save", async () => {
    const request = deferredSave();
    const onSave = vi.fn().mockImplementationOnce(() => request.promise).mockResolvedValue(undefined);
    function ControlledEditor() {
      const [value, setValue] = useState("Original");
      return <InlineEditor value={value} multiline defaultEditing onSave={async (next) => {
        await onSave(next);
        setValue(next);
      }} />;
    }
    act(() => root.render(<ControlledEditor />));
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      input.focus();
      setNativeTextareaValue(input, "First draft");
    });
    await advance(900);
    act(() => {
      setNativeTextareaValue(input, "Original");
      outside.focus();
    });
    await advance(32);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("First draft");
    await act(async () => { request.resolve(); });
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Original");
    await advance(5000);
    expect(onSave.mock.calls.map(([value]) => value)).toEqual(["First draft", "Original"]);
    expect(container.textContent).toContain("Original");
    expect(container.textContent).not.toContain("First draft");
  });

  it("Escape cancels a queued blur and debounce without saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const input = render(onSave);
    act(() => setNativeTextareaValue(input, "Canceled draft"));
    act(() => outside.focus());
    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await advance(5000);
    expect(onSave).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Original");
    expect(container.textContent).not.toContain("Canceled draft");
  });

  it("accepts a remote value after Escape and immediate reopening without another edit", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const input = render(onSave);
    act(() => setNativeTextareaValue(input, "Canceled draft"));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => enterMultilineEdit(container));
    const reopened = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => reopened.focus());
    act(() => root.render(<InlineEditor value="Remote update" multiline defaultEditing onSave={onSave} />));
    expect(reopened.value).toBe("Remote update");
    await advance(5000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("retains a rejected single-line edit with an explicit retry", async () => {
    const request = deferredSave();
    const onSave = vi.fn().mockImplementationOnce(() => request.promise).mockResolvedValue(undefined);
    act(() => root.render(<InlineEditor value="Original" onSave={onSave} />));
    act(() => container.querySelector("span")!.click());
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      setNativeTextareaValue(input, "Edited title");
      outside.focus();
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Edited title");
    await act(async () => { request.reject(new Error("Title save rejected")); });
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Edited title");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    await advance(5000);
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => { retryButton()!.click(); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("Edited title");
  });

  it("does not save an unsaved draft when unmounted", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const input = render(onSave);
    act(() => setNativeTextareaValue(input, "Unmounted draft"));
    act(() => root.render(null));
    await advance(5000);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("queueContainedBlurCommit", () => {
  let container: HTMLDivElement;
  let inside: HTMLTextAreaElement;
  let outside: HTMLButtonElement;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame;

    container = document.createElement("div");
    inside = document.createElement("textarea");
    outside = document.createElement("button");
    container.appendChild(inside);
    document.body.append(container, outside);
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    container.remove();
    outside.remove();
    vi.useRealTimers();
  });

  async function flushFrames() {
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
  }

  it("commits when focus stays outside the editor container", async () => {
    const onCommit = vi.fn();
    const cancel = queueContainedBlurCommit(container, onCommit);

    outside.focus();
    await flushFrames();

    expect(onCommit).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("skips the commit when focus returns inside before the delayed check completes", async () => {
    const onCommit = vi.fn();
    const cancel = queueContainedBlurCommit(container, onCommit);

    outside.focus();
    inside.focus();
    await flushFrames();

    expect(onCommit).not.toHaveBeenCalled();
    cancel();
  });
});
