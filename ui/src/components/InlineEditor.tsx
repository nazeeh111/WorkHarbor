import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../lib/utils";
import { MarkdownBody, type MarkdownExternalReferenceMap } from "./MarkdownBody";
import { MarkdownEditor, type MarkdownEditorRef, type MentionOption } from "./MarkdownEditor";
import { useAutosaveIndicator } from "../hooks/useAutosaveIndicator";
import { FoldCurtain } from "./FoldCurtain";

interface InlineEditorProps {
  value: string;
  onSave: (value: string) => void | Promise<unknown>;
  as?: "h1" | "h2" | "p" | "span";
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  imageUploadHandler?: (file: File) => Promise<string>;
  /** Called when a non-image file is dropped onto the editor. */
  onDropFile?: (file: File) => Promise<void>;
  mentions?: MentionOption[];
  nullable?: boolean;
  /** When true, long display-mode markdown is clipped with a fade curtain that expands on click. */
  foldable?: boolean;
  /**
   * Optional host-resolved external object metadata. Forwarded to the read-mode
   * `MarkdownBody` so resolved URLs render with the inline status icon prefix.
   */
  externalReferences?: MarkdownExternalReferenceMap;
  /**
   * Mount the multiline editor already in edit mode, focused — for hosts whose
   * own affordance opens the editor (the description bubble's pencil, PAP-375).
   */
  defaultEditing?: boolean;
  /** Notified when the multiline editor swaps between display and edit mode. */
  onEditingChange?: (editing: boolean) => void;
}

/** Shared padding so display and edit modes occupy the exact same box. */
const pad = "px-1 -mx-1";
const markdownPad = "px-1";
const AUTOSAVE_DEBOUNCE_MS = 900;

export function queueContainedBlurCommit(container: HTMLDivElement, onCommit: () => void) {
  let frameId = requestAnimationFrame(() => {
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      const active = document.activeElement;
      if (active instanceof Node && container.contains(active)) return;
      onCommit();
    });
  });

  return () => {
    if (frameId === 0) return;
    cancelAnimationFrame(frameId);
    frameId = 0;
  };
}

export function InlineEditor({
  value,
  onSave,
  as: Tag = "span",
  className,
  placeholder = "Click to edit...",
  multiline = false,
  nullable = false,
  imageUploadHandler,
  onDropFile,
  mentions,
  foldable = false,
  externalReferences,
  defaultEditing = false,
  onEditingChange,
}: InlineEditorProps) {
  const [editing, setEditing] = useState(false);
  const [multilineEditing, setMultilineEditing] = useState(multiline && defaultEditing);
  const [multilineFocused, setMultilineFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const savedValueRef = useRef(value);
  const draftRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const savePendingRef = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const lastPropValueRef = useRef(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const markdownRef = useRef<MarkdownEditorRef>(null);
  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurCommitFrameRef = useRef<(() => void) | null>(null);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const justEnteredEditRef = useRef(multiline && defaultEditing);
  const hasBeenFocusedRef = useRef(false);
  const {
    state: autosaveState,
    markDirty,
    reset,
    runSave,
  } = useAutosaveIndicator();
  const autosaveStateRef = useRef(autosaveState);
  useEffect(() => {
    autosaveStateRef.current = autosaveState;
  }, [autosaveState]);

  useEffect(() => {
    const previousValue = lastPropValueRef.current;
    if (previousValue === value) return;
    lastPropValueRef.current = value;
    savedValueRef.current = value;
    // A response for an earlier save must not overwrite edits made while it
    // was pending, even if focus has since moved outside the editor.
    if (draftRevisionRef.current === savedRevisionRef.current
      || (!editing && !multilineEditing && !multilineFocused)) {
      draftRef.current = value;
      savedRevisionRef.current = draftRevisionRef.current;
      setDraft(value);
    }
  }, [value, editing, multilineEditing, multilineFocused]);

  useEffect(() => {
    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
      }
      if (blurCommitFrameRef.current !== null) {
        blurCommitFrameRef.current();
        blurCommitFrameRef.current = null;
      }
      if (pendingFocusFrameRef.current !== null) {
        cancelAnimationFrame(pendingFocusFrameRef.current);
        pendingFocusFrameRef.current = null;
      }
    };
  }, []);

  const autoSize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      if (inputRef.current instanceof HTMLTextAreaElement) {
        autoSize(inputRef.current);
      }
    }
  }, [editing, autoSize]);

  useEffect(() => {
    if (!multilineEditing || !multiline) return;
    if (!justEnteredEditRef.current) return;
    justEnteredEditRef.current = false;
    if (pendingFocusFrameRef.current !== null) {
      cancelAnimationFrame(pendingFocusFrameRef.current);
    }
    pendingFocusFrameRef.current = requestAnimationFrame(() => {
      pendingFocusFrameRef.current = null;
      markdownRef.current?.focus();
    });
    return () => {
      if (pendingFocusFrameRef.current !== null) {
        cancelAnimationFrame(pendingFocusFrameRef.current);
        pendingFocusFrameRef.current = null;
      }
    };
  }, [multilineEditing, multiline]);

  // Once the editor has been focused at least once, it's blurred, and any
  // autosave has settled, swap back to the MarkdownBody preview so inline
  // issue refs render with status + quicklook.
  useEffect(() => {
    if (multilineFocused) {
      hasBeenFocusedRef.current = true;
      return;
    }
    if (!multiline || !multilineEditing) return;
    if (!hasBeenFocusedRef.current) return;
    if (savePending || draft.trim() !== savedValueRef.current) return;
    if (autosaveState !== "idle") return;
    hasBeenFocusedRef.current = false;
    setMultilineEditing(false);
    onEditingChange?.(false);
  }, [multiline, multilineEditing, multilineFocused, savePending, draft, autosaveState, onEditingChange]);

  const changeDraft = useCallback((nextValue: string) => {
    if (nextValue === draftRef.current) return;
    draftRevisionRef.current += 1;
    draftRef.current = nextValue;
    setDraft(nextValue);
    markDirty();
  }, [markDirty]);

  // This is the error boundary for saves started by this editor's events and
  // debounce. The shared hook still rejects for callers that await it; here
  // its error state keeps the draft editable and exposes an explicit retry.
  const saveDraft = useCallback(async (retry = false) => {
    if (savePendingRef.current) return;
    // Blur is deferred by two animation frames, so its callback may predate
    // the failure. Only an explicit retry may resubmit that unchanged draft.
    if (!retry && autosaveStateRef.current === "error") return;
    const valueToSave = draftRef.current.trim();
    const valueChanged = valueToSave !== savedValueRef.current;
    const shouldSave = nullable
      ? valueChanged
      : Boolean(valueToSave && valueChanged);
    if (!shouldSave) {
      draftRef.current = savedValueRef.current;
      savedRevisionRef.current = draftRevisionRef.current;
      setDraft(savedValueRef.current);
      reset();
      if (!multiline) setEditing(false);
      return;
    }
    savePendingRef.current = true;
    const revisionToSave = draftRevisionRef.current;
    setSavePending(true);
    try {
      await runSave(async () => {
        await onSave(valueToSave);
        savedValueRef.current = valueToSave;
        savedRevisionRef.current = revisionToSave;
      });
      if (!multiline && draftRef.current.trim() === valueToSave) setEditing(false);
    } catch {
      // runSave has set the visible error state. Leave the current draft in
      // place, including newer text typed during this request.
    } finally {
      savePendingRef.current = false;
      setSavePending(false);
    }
  }, [multiline, nullable, onSave, reset, runSave]);

  /** Multiline blur/submit: show autosave indicator when persisting */
  const finalizeMultilineBlurOrSubmit = useCallback(() => {
    if (autosaveState === "error") return;
    void saveDraft();
  }, [autosaveState, saveDraft]);

  const cancelPendingBlurCommit = useCallback(() => {
    if (blurCommitFrameRef.current === null) return;
    blurCommitFrameRef.current();
    blurCommitFrameRef.current = null;
  }, []);

  const scheduleBlurCommit = useCallback((container: HTMLDivElement) => {
    cancelPendingBlurCommit();
    blurCommitFrameRef.current = queueContainedBlurCommit(container, () => {
      blurCommitFrameRef.current = null;
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
      }
      setMultilineFocused(false);
      finalizeMultilineBlurOrSubmit();
    });
  }, [cancelPendingBlurCommit, finalizeMultilineBlurOrSubmit]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      if (autosaveState !== "error") void saveDraft();
    }
    if (e.key === "Escape") {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
      }
      cancelPendingBlurCommit();
      reset();
      draftRef.current = value;
      savedRevisionRef.current = draftRevisionRef.current;
      setDraft(value);
      if (multiline) {
        setMultilineFocused(false);
        setMultilineEditing(false);
        onEditingChange?.(false);
        hasBeenFocusedRef.current = false;
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } else {
        setEditing(false);
      }
    }
  }

  useEffect(() => {
    if (!multiline) return;
    if (!multilineEditing && !multilineFocused) return;
    if (savePending || autosaveState === "error") return;
    const trimmed = draft.trim();
    // Nullable: empty draft can still be a real edit (clearing); only skip debounce when unchanged or empty is invalid.
    if (trimmed === savedValueRef.current || (!trimmed && !nullable)) return;
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
    }
    autosaveDebounceRef.current = setTimeout(() => {
      void saveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
      }
    };
  }, [autosaveState, draft, multiline, multilineEditing, multilineFocused, nullable, savePending, saveDraft, value]);

  const saveError = autosaveState === "error" ? (
    <span role="alert" className="flex items-center gap-2 text-(length:--text-micro) text-destructive">
      Could not save
      <button
        type="button"
        disabled={savePending}
        className="cursor-pointer underline underline-offset-2"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { void saveDraft(true); }}
      >
        Retry save
      </button>
    </span>
  ) : null;

  if (multiline) {
    const previewValue = draft;
    const hasValue = Boolean(previewValue.trim());
    const showEditor = multilineEditing || multilineFocused || savePending || autosaveState === "error" || !hasValue;

    if (!showEditor) {
      const enterEditMode = () => {
        if (multilineEditing) return;
        justEnteredEditRef.current = true;
        setMultilineEditing(true);
        onEditingChange?.(true);
      };
      return (
        <div
          className={cn(markdownPad, "rounded transition-colors hover:bg-accent/20")}
          onClick={(event) => {
            if (event.defaultPrevented) return;
            const target = event.target as HTMLElement | null;
            if (target && target.closest("a,button,[data-mention-kind],[data-radix-popper-content-wrapper]")) {
              return;
            }
            enterEditMode();
          }}
          onDragEnter={() => enterEditMode()}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            enterEditMode();
          }}
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          tabIndex={0}
        >
          {foldable ? (
            <FoldCurtain>
              <MarkdownBody
                className={cn("paperclip-edit-in-place-content", className)}
                externalReferences={externalReferences}
              >
                {previewValue}
              </MarkdownBody>
            </FoldCurtain>
          ) : (
            <MarkdownBody
              className={cn("paperclip-edit-in-place-content", className)}
              externalReferences={externalReferences}
            >
              {previewValue}
            </MarkdownBody>
          )}
        </div>
      );
    }

    return (
      <div
        className={cn(
          markdownPad,
          "rounded transition-colors",
          multilineFocused ? "bg-transparent" : "hover:bg-accent/20",
        )}
        onFocusCapture={(event) => {
          // Ignore focus events where the active element isn't actually inside
          // the wrapper (React 19 can emit a synthetic focus after a blur).
          const active = document.activeElement;
          if (!(active instanceof Node) || !event.currentTarget.contains(active)) return;
          cancelPendingBlurCommit();
          setMultilineEditing(true);
          setMultilineFocused(true);
        }}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          if (pendingFocusFrameRef.current !== null) {
            cancelAnimationFrame(pendingFocusFrameRef.current);
            pendingFocusFrameRef.current = null;
          }
          scheduleBlurCommit(event.currentTarget);
        }}
        onKeyDown={handleKeyDown}
      >
        <MarkdownEditor
          ref={markdownRef}
          value={draft}
          onChange={changeDraft}
          placeholder={placeholder}
          bordered={false}
          className="bg-transparent"
          contentClassName={cn("paperclip-edit-in-place-content", className)}
          imageUploadHandler={imageUploadHandler}
          onDropFile={onDropFile}
          mentions={mentions}
          onSubmit={() => {
            finalizeMultilineBlurOrSubmit();
          }}
        />
        <div className="flex min-h-4 items-center justify-end pr-1">
          {saveError ?? <span
            className={cn(
              "text-(length:--text-micro) transition-opacity duration-150",
              "text-muted-foreground",
              autosaveState === "idle" || (autosaveState === "saved" && draft.trim() !== savedValueRef.current)
                ? "opacity-0" : "opacity-100",
            )}
          >
            {autosaveState === "saving"
              ? "Autosaving..."
              : autosaveState === "saved"
                ? "Saved"
                : "Idle"}
          </span>}
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={(e) => {
            changeDraft(e.target.value);
            autoSize(e.target);
          }}
          onBlur={() => {
            if (autosaveState !== "error") void saveDraft();
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full bg-transparent rounded outline-none resize-none overflow-hidden",
            pad,
            className
          )}
        />
        {saveError}
      </>
    );
  }

  // Use div instead of Tag when rendering markdown to avoid invalid nesting
  // (e.g. <p> cannot contain the <div>/<p> elements that markdown produces)
  const DisplayTag = value && multiline ? "div" : Tag;

  return (
    <DisplayTag
      className={cn(
        "cursor-pointer rounded hover:bg-accent/50 transition-colors overflow-hidden",
        pad,
        !value && "text-muted-foreground italic",
        className,
      )}
      onClick={() => setEditing(true)}
    >
      {value || placeholder}
    </DisplayTag>
  );
}
