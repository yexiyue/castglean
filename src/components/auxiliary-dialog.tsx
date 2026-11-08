import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Secondary controls stay outside the document flow; drafts belong to the caller. */
export function AuxiliaryDialog({
  title,
  children,
  disabled,
  keepMounted,
}: {
  title: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  keepMounted?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
          />
        }
      >
        {title}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" keepMounted={keepMounted}>
        <DialogTitle className="pr-8">{title}</DialogTitle>
        <div className="min-w-0 space-y-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
