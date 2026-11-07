import { CpuIcon } from "lucide-react";
import cosyvoice3 from "@/assets/models/cosyvoice3.jpg";
import indextts from "@/assets/models/indextts.png";
import kokoro from "@/assets/models/kokoro.png";
import moss from "@/assets/models/moss.png";
import qwen from "@/assets/models/qwen.png";
import voxcpm from "@/assets/models/voxcpm.png";
import { cn } from "@/lib/utils";

// 新增 logo：放入 src/assets/models/{backend}.png 并在此登记即可（见该目录 README）。
const logos: Record<string, string> = {
  qwen,
  kokoro,
  indextts,
  cosyvoice3,
  moss,
  voxcpm,
};

/** 设计引擎 ID 带 `-voicedesign` 后缀（如 `qwen-voicedesign`），归一到基础后端再查表。 */
function logoKey(backend: string): string {
  return backend.replace(/-voicedesign$/, "");
}

/**
 * 模型标识：真实 logo 放在有边线的小圆角底板上，保证亮暗主题都可读；
 * 未知后端回退到通用芯片图标。
 */
export function ModelLogo({
  backend,
  className,
}: {
  backend: string;
  className?: string;
}) {
  const src = logos[logoKey(backend)];
  if (!src)
    return (
      <CpuIcon
        aria-hidden="true"
        className={cn("text-muted-foreground size-5 shrink-0", className)}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={cn(
        "border-border bg-card flex size-9 shrink-0 items-center justify-center rounded-md border p-1",
        className,
      )}
    >
      <img src={src} alt="" className="size-full object-contain" />
    </span>
  );
}
