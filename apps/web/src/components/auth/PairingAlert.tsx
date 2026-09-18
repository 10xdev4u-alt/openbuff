import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Accessibility primitives for the pairing surfaces (issue #80).
 *
 * The pairing page is the front door for remote visitors; its failure states
 * were previously plain divs — invisible to screen readers. `PairingAlert`
 * renders an assertive live region (`role="alert"`) so a rejected or expired
 * token is announced the moment it appears. `PairingStatus` renders a polite
 * live region (`role="status"`) for progress messages. `busyAttribute` keeps
 * submit controls honest about in-flight work (`aria-busy`). No copy changes,
 * no visual redesign — pure semantics.
 */

export function PairingAlert({
  message,
  className,
}: {
  message: ReactNode | null | undefined;
  className?: string;
}) {
  if (message === null || message === undefined || message === "") {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive",
        className,
      )}
      role="alert"
    >
      {message}
    </div>
  );
}

export function PairingStatus({
  message,
  className,
}: {
  message: ReactNode | null | undefined;
  className?: string;
}) {
  if (message === null || message === undefined || message === "") {
    return null;
  }

  return (
    <p className={cn("text-sm leading-relaxed text-muted-foreground", className)} role="status">
      {message}
    </p>
  );
}

export function busyAttribute(isBusy: boolean): { "aria-busy": "true" | "false" } {
  return { "aria-busy": isBusy ? "true" : "false" };
}
