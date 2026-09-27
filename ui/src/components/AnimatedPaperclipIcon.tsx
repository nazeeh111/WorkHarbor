import { cn } from "../lib/utils";
import { WorkHarborMark } from "./WorkHarborBrand";

/** Full-page loading state. The accessible status text remains available. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <WorkHarborMark className="size-16 text-primary motion-safe:animate-pulse" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
