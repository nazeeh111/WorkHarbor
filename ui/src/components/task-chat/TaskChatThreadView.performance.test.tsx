// @vitest-environment jsdom

import { act, forwardRef, memo, useImperativeHandle, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatThreadView } from "./TaskChatThreadView";
import { IssueGalleryContext } from "@/context/IssueGalleryContext";
import type { TaskChatItem, TaskChatMessageItem } from "./task-chat-model";
import { TaskChatDescriptionBubble } from "./TaskChatDescriptionBubble";

vi.mock("@/components/MarkdownEditor", () => ({
  // Keep the actual description/InlineEditor lifecycle; only replace the rich
  // markdown input, which cannot be rendered in jsdom.
  MarkdownEditor: forwardRef<{ focus: () => void }, {
    value: string;
    onChange: (value: string) => void;
  }>(function MarkdownEditorMock({ value, onChange }, ref) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
    return <textarea ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} />;
  }),
}));

const renders = vi.hoisted(() => vi.fn());
vi.mock("@/components/MarkdownBody", () => ({
  // Preserve the real markdown component's memo contract while counting work.
  MarkdownBody: memo((props: { children: string; onImageClick?: (src: string) => void }) => {
    renders(props.children);
    return <button onClick={() => props.onImageClick?.("image.png")}>{props.children}</button>;
  }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  renders.mockClear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function changeInput(input: HTMLTextAreaElement, value: string) {
  const previous = input.value;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
  const tracker = (input as HTMLTextAreaElement & { _valueTracker?: { setValue: (value: string) => void } })._valueTracker;
  tracker?.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function descriptionThread(onSave: (value: string) => Promise<void>) {
  const items: TaskChatItem[] = [{ id: "description", kind: "brief" }];
  const renderBrief = () => <TaskChatDescriptionBubble brief={{ description: "", author: "human", onSave }} />;
  return (scroll: boolean) => act(() => root.render(
    <TaskChatThreadView items={items} scroll={scroll} renderBrief={renderBrief} />,
  ));
}

it.each([true, false])("retains an unsaved description across both responsive modes, starting scroll=%s", async (initialScroll) => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const render = descriptionThread(onSave);
  render(initialScroll);
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="task-chat-description-ghost"]')!.click());
  const input = host.querySelector("textarea")!;
  act(() => {
    input.focus();
    changeInput(input, "Resize draft sentinel");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });

  render(!initialScroll);
  expect(host.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("Resize draft sentinel");
  render(initialScroll);
  expect(host.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("Resize draft sentinel");
  expect(onSave).not.toHaveBeenCalled();

  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(onSave).toHaveBeenCalledExactlyOnceWith("Resize draft sentinel");
});

it("still cancels a description draft with Escape after a responsive round trip", async () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const render = descriptionThread(onSave);
  render(true);
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="task-chat-description-ghost"]')!.click());
  const input = host.querySelector("textarea")!;
  act(() => {
    input.focus();
    changeInput(input, "Do not persist this draft");
  });
  render(false);
  render(true);
  expect(host.querySelector("textarea")).toBe(input);
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.querySelector('[data-testid="task-chat-description-ghost"]')).not.toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});

const history: TaskChatMessageItem[] = Array.from({ length: 200 }, (_, index) => ({
  id: `message-${index}`, kind: "message", author: "agent", text: `Response ${index}`,
}));

it("does no historical render work for a live-tail-only update", () => {
  const actions = vi.fn(() => null);
  const render = (tick: number) => act(() => root.render(
    <TaskChatThreadView items={history} scroll={false} renderMessageActions={actions} tail={<p>Live {tick}</p>} />,
  ));
  render(0);
  renders.mockClear();
  actions.mockClear();
  for (let tick = 1; tick <= 10; tick++) render(tick);
  expect(renders).not.toHaveBeenCalled();
  expect(actions).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Live 10");
});

it("does not reparse unchanged markdown when transcript projection recreates rows", () => {
  const render = (items: TaskChatItem[]) => act(() => root.render(
    <TaskChatThreadView items={items} scroll={false} />,
  ));
  render(history);
  renders.mockClear();
  for (let tick = 0; tick < 10; tick++) render(history.map((item) => ({ ...item })));
  expect(renders).not.toHaveBeenCalled();
  render(history.map((item, index) => index === 199 ? { ...item, text: "Edited response" } : item));
  expect(renders).toHaveBeenCalledExactlyOnceWith("Edited response");
  expect(host.textContent).toContain("Edited response");
});

it("uses the current gallery callback after the provider changes", () => {
  const firstGallery = vi.fn(() => true);
  const nextGallery = vi.fn(() => true);
  const render = (gallery: (src: string) => boolean) => act(() => root.render(
    <IssueGalleryContext.Provider value={gallery}>
      <TaskChatThreadView items={history.slice(0, 1)} scroll={false} />
    </IssueGalleryContext.Provider>,
  ));
  render(firstGallery);
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  render(nextGallery);
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(firstGallery).toHaveBeenCalledExactlyOnceWith("image.png");
  expect(nextGallery).toHaveBeenCalledExactlyOnceWith("image.png");
});
