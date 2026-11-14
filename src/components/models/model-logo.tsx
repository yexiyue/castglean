import { CpuIcon } from "lucide-react";
import cosyvoice3 from "@/assets/models/cosyvoice3.jpg";
import indextts from "@/assets/models/indextts.jpg";
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
  size = "default",
}: {
  backend: string;
  size?: "sm" | "default" | "lg";
}) {
  const src = logos[logoKey(backend)];
  if (!src)
    return (
      <CpuIcon
        aria-hidden="true"
        data-slot="model-logo"
        className={cn(
          "shrink-0 text-muted-foreground",
          size === "sm" ? "size-6 p-0.5" : size === "lg" ? "size-12" : "size-5",
        )}
      />
    );
  return (
    <span
      aria-hidden="true"
      data-slot="model-logo"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-surface border border-border bg-card",
        size === "sm"
          ? "size-6 p-0.5"
          : size === "lg"
            ? "size-12 p-1"
            : "size-9 p-1",
      )}
    >
      <img src={src} alt="" className="size-full object-contain" />
    </span>
  );
}
