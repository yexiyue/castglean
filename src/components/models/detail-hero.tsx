import type { ReactNode } from "react";
import { DialogHeader } from "@/components/ui/dialog";

/** 详情弹窗的档案卡头部：全宽色带构成第一层，内容（标识/标题/徽章）由调用方给出。 */
export function DetailHero({ children }: { children: ReactNode }) {
  return (
    <DialogHeader className="border-border bg-muted/50 rounded-t-xl border-b px-5 py-4">
      {children}
    </DialogHeader>
  );
}
