import type { ReactNode } from "react";

/**
 * A form's field: what it's for, then its input (a text input, a text area, a select…). It's a
 * label, so a click on its name goes to the input; `group` makes it a plain block instead, for
 * a field of several controls (an input and its Choose… button), where clicks shouldn't move.
 */
export function Field({ label, group, className, children }: { label: ReactNode; group?: boolean; className?: string; children: ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={className ? `field ${className}` : "field"}>
      <span>{label}</span>
      {children}
    </Tag>
  );
}
