import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { VoiceLibraryRows, type VoiceListItem } from "./voice-library-rows";

export function VoiceLibraryRowsPreview() {
  const { t, i18n } = useLingui();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const items: VoiceListItem[] = [
    {
      id: "narrator",
      name: t({ message: "旁白音色" }),
      description: t({ message: "温和沉稳，适合长篇叙事。" }),
      source: "WAV",
      duration: 8.4,
      bytes: 403244,
    },
    {
      id: "character",
      name: t({ message: "角色音色", comment: "音色列表中的示例名称" }),
      description: t({ message: "清晰自然的对话录音。" }),
      source: "MOSS",
      duration: 12.8,
      bytes: 614444,
    },
    {
      id: "unknown",
      name: t({ message: "属性缺失示例" }),
      description: null,
      source: null,
      duration: null,
      bytes: null,
    },
  ];
  const visible = items.filter((item) =>
    `${item.name} ${item.description ?? ""}`
      .toLocaleLowerCase(i18n.locale)
      .includes(query.trim().toLocaleLowerCase(i18n.locale)),
  );
  return (
    <section id="voice-library-rows" className="scroll-mt-6 space-y-5">
      <h2 className="text-base font-semibold">
        <Trans>音色库属性行示例</Trans>
      </h2>
      <p className="text-muted-foreground text-sm">
        <Trans>可搜索和选择示例音色；详情与试听按钮不读取真实资产。</Trans>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm"
          aria-label={t({ message: "搜索我的音色" })}
          placeholder={t({ message: "搜索名称或描述…" })}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p role="status" className="text-muted-foreground text-sm">
          <Trans comment="示例列表中选中的音色数量">
            已选择 {selected.size} 个音色
          </Trans>
        </p>
      </div>
      <VoiceLibraryRows
        items={visible}
        selected={selected}
        onSelect={(id, checked) =>
          setSelected((previous) => {
            const next = new Set(previous);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          })
        }
      />
      {!visible.length && (
        <p role="status" className="text-muted-foreground text-sm">
          <Trans>没有匹配的音色</Trans>
        </p>
      )}
      <h3 className="text-sm font-medium">
        <Trans comment="当前模型真实附带的声音目录">预置音色</Trans>
      </h3>
      <VoiceLibraryRows
        preset
        items={[
          { id: "preset-1", name: "Narrator", source: "Kokoro" },
          { id: "preset-2", name: "Storyteller", source: "MOSS" },
        ]}
      />
    </section>
  );
}
