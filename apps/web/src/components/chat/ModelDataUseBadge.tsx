/**
 * Per-row data-use disclosure badge for freebuff picker rows — renders the
 * disclosure view-model's short label as a warning-styled chip with the
 * full sentence as title/aria-label. Undefined renders nothing, so
 * non-freebuff rows and undisclosed freebuff rows are untouched.
 *
 * @module components/chat/ModelDataUseBadge
 */
import type { FreebuffPickerDisclosure } from "./modelPickerDisclosures";

export function ModelDataUseBadge(props: {
  disclosure: FreebuffPickerDisclosure | undefined;
}) {
  if (!props.disclosure) {
    return null;
  }
  return (
    <span
      className="shrink-0 rounded border border-warning/35 bg-warning/15 px-0.5 py-px text-[10px] font-semibold uppercase leading-none tracking-wide text-warning-foreground"
      title={props.disclosure.title}
      aria-label={props.disclosure.title}
    >
      {props.disclosure.label}
    </span>
  );
}
