import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/** Two piers and an open channel, drawn as a single WorkHarbor mark. */
export function WorkHarborMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M4 4v16h6v-8h4v8h6V4" />
    </svg>
  );
}

export function WorkHarborLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-primary", className)}>
      <WorkHarborMark className="size-6" />
      <span className="text-base font-semibold tracking-tight">WorkHarbor</span>
    </span>
  );
}
