// Adapted from the assistant-ui Approval Card action row.
import type { ReactNode } from "react";

export function ApprovalActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="approval-actions"
      className="flex min-h-8 flex-wrap items-center gap-2"
    >
      {children}
    </div>
  );
}
