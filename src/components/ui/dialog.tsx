import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Trans } from "@lingui/react/macro";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";

function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: DialogPrimitive.Root.Props) {
  // 镜像开合状态：受控取 prop，非受控跟随 onOpenChange，用于挂载弹窗独占作用域
  const [mirrorOpen, setMirrorOpen] = useState(defaultOpen ?? false);
  const open = openProp ?? mirrorOpen;
  const scope = `dialog-${useId()}`;
  return (
    <>
      <DialogPrimitive.Root
        data-slot="dialog"
        open={openProp}
        defaultOpen={defaultOpen}
        onOpenChange={(next, details) => {
          setMirrorOpen(next);
          onOpenChange?.(next, details);
        }}
        {...props}
      />
      {open ? (
        // 打开期间独占键盘：暂停外部全局快捷键，关闭即恢复（keyboard-shortcuts R2）
        <HotkeysProvider scope={scope} exclusive>
          {null}
        </HotkeysProvider>
      ) : null}
    </>
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/30 duration-150 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  keepMounted,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  keepMounted?: boolean;
}) {
  return (
    <DialogPortal keepMounted={keepMounted}>
      <DialogOverlay forceRender />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground border-border data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 rounded-overlay fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-1/2 auto-rows-max gap-4 overflow-y-auto overscroll-contain border p-4 text-sm shadow-sm duration-150 outline-none motion-reduce:animate-none sm:max-w-sm",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">
              <Trans comment="关闭对话框">关闭</Trans>
            </span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-muted/50 rounded-b-overlay -mx-4 -mb-4 flex flex-col-reverse flex-wrap gap-2 border-t p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          <Trans comment="关闭对话框">关闭</Trans>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
