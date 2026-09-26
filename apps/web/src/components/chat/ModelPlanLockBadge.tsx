/**
 * Per-row plan-lock badge for tier-locked freebuff picker rows — renders the
 * upstream "Paid plan" label as a neutral chip with the plan-required line
 * as title/aria. Undefined/false renders nothing, so unlocked rows are
 * untouched. The row itself is drawn disabled with the same sentence as its
 * tooltip reason (upstream's freebuffPlanRequired doctrine: listed, not
 * hidden — the lock names what stands between the user and the row).
 *
 * @module components/chat/ModelPlanLockBadge
 */

export function ModelPlanLockBadge(props: {
  planRequired: boolean | undefined;
  line: string | undefined;
}) {
  if (!props.planRequired) {
    return null;
  }
  return (
    <span
      className="shrink-0 rounded border border-border/60 bg-muted px-0.5 py-px text-[10px] font-semibold uppercase leading-none tracking-wide text-muted-foreground"
      title={props.line}
      aria-label={props.line}
    >
      Paid plan
    </span>
  );
}
