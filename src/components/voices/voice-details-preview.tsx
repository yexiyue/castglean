import { Trans, useLingui } from "@lingui/react/macro";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import type { LibraryVoice } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import { LibraryVoiceEditor } from "./library-voice-editor";
import {
  LibraryVoiceProperties,
  VoiceDetailContent,
  VoiceReference,
} from "./voice-detail-content";

export function VoiceDetailsPreview() {
  const { t } = useLingui();
  const studio = useVoiceStudio();
  const voices: LibraryVoice[] = [
    {
      id: "example-narrator-voice-identity",
      name: t({ message: "旁白音色", comment: "音色详情示例名称" }),
      description: t({ message: "温和沉稳，适合长篇叙事。" }),
      transcript:
        "夜潮退去，渡口的灯还亮着。\n风吹过松林，远处传来归人的脚步声。",
      source: "WAV",
      duration: 8.4,
      bytes: 403244,
      created_at: 1793836800,
      imported_at: 1793923200,
    },
    {
      id: "example-missing-metadata",
      name: t({
        message: "属性缺失示例",
        comment: "演示未知属性如何显示，不代表真实资产",
      }),
      transcript: "",
      description: null,
      source: null,
      duration: null,
      bytes: null,
      created_at: null,
      imported_at: null,
    },
  ];
  return (
    <section id="voice-detail-layout" className="scroll-mt-6 space-y-5">
      <h2 className="text-base font-semibold">
        <Trans>音色详情布局示例</Trans>
      </h2>
      <p className="text-muted-foreground text-sm">
        <Trans>
          以下为示例音色，可展开属性与管理区域；不会播放、生成或修改真实音色。
        </Trans>
      </p>
      <div className="grid max-w-5xl items-start gap-5 lg:grid-cols-2">
        {voices.map((voice) => (
          <article key={voice.id} className="min-w-0 rounded-md border">
            <h3 className="px-6 pt-5 pb-4 font-medium wrap-anywhere">
              {voice.name}
            </h3>
            <VoiceDetailContent
              properties={<LibraryVoiceProperties voice={voice} />}
              reference={<VoiceReference voice={voice} />}
              audition={
                <AuditionPanel
                  studio={{ ...studio, desktop: false }}
                  voice={{ kind: "library", id: voice.id }}
                />
              }
              management={
                <LibraryVoiceEditor name={voice.name} savedName={voice.name} />
              }
            />
          </article>
        ))}
      </div>
    </section>
  );
}
