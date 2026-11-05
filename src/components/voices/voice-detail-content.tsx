import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { LibraryVoice } from "@/lib/bindings";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";

export function VoiceProperties({
  rows,
}: {
  rows: { id: string; label: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl className="divide-y text-sm">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)] gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 wrap-anywhere whitespace-pre-wrap">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function LibraryVoiceProperties({ voice }: { voice: LibraryVoice }) {
  const { i18n } = useLingui();
  const date = (seconds: number | null) => {
    if (seconds === null || !Number.isFinite(seconds)) return "—";
    const value = new Date(seconds * 1000);
    return Number.isNaN(value.getTime())
      ? "—"
      : value.toLocaleString(i18n.locale);
  };
  const duration = formatVoiceDuration(voice.duration, i18n.locale);
  return (
    <div className="space-y-4">
      <VoiceProperties
        rows={[
          {
            id: "description",
            label: <Trans comment="音色详情中的声音描述">声音描述</Trans>,
            value: voice.description?.trim() || "—",
          },
          {
            id: "source",
            label: <Trans comment="声音的来源引擎或用户录音">来源</Trans>,
            value: voice.source?.trim() || "—",
          },
          {
            id: "duration",
            label: <Trans comment="音色原始录音长度">录音时长</Trans>,
            value: duration === null ? "—" : <Trans>{duration} 秒</Trans>,
          },
          {
            id: "bytes",
            label: <Trans comment="音色原始录音占用的存储空间">录音大小</Trans>,
            value: formatVoiceSize(voice.bytes, i18n.locale),
          },
        ]}
      />
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer">
          <Trans comment="展开音色身份与创建入库时间">更多属性</Trans>
        </summary>
        <div className="pt-3">
          <VoiceProperties
            rows={[
              {
                id: "identity",
                label: <Trans comment="稳定音色 ID 字段">音色身份</Trans>,
                value: voice.id,
              },
              {
                id: "created",
                label: (
                  <Trans comment="音色资产首次创建的时间，导入时保留">
                    原始创建时间
                  </Trans>
                ),
                value: date(voice.created_at),
              },
              {
                id: "imported",
                label: (
                  <Trans comment="音色导入本设备音色库的时间">
                    本机入库时间
                  </Trans>
                ),
                value: date(voice.imported_at),
              },
            ]}
          />
        </div>
      </details>
    </div>
  );
}

export function VoiceReference({
  voice,
  busy = false,
  failed = false,
  onPlay,
}: {
  voice: LibraryVoice;
  busy?: boolean;
  failed?: boolean;
  onPlay?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          <Trans comment="库内音色的原始声音及其准确参考文本">原始录音</Trans>
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !onPlay}
          onClick={onPlay}
        >
          <Trans comment="播放库内音色的原始录音，不运行模型">
            试听原始录音
          </Trans>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        <Trans>直接播放保存的录音，无需加载模型。</Trans>
      </p>
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">
          <Trans comment="原始录音对应的准确文本">参考文本</Trans>
        </p>
        <p className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
          {voice.transcript.trim() ? voice.transcript : "—"}
        </p>
      </div>
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          <Trans>无法读取原始录音，请检查音色文件是否仍可访问后重试。</Trans>
        </p>
      )}
    </div>
  );
}

export function VoiceDetailContent({
  properties,
  reference,
  audition,
  results,
  management,
}: {
  properties: ReactNode;
  reference?: ReactNode;
  audition: ReactNode;
  results?: ReactNode;
  management?: ReactNode;
}) {
  return (
    <div
      className="space-y-6 px-6 pt-2"
      style={{ paddingBottom: "max(3rem, var(--voice-player-inset, 0px))" }}
    >
      {properties}
      {reference && <section className="border-t pt-5">{reference}</section>}
      <section className="space-y-4 border-t pt-5">
        {audition}
        {results}
      </section>
      {management && (
        <details className="border-t pt-5">
          <summary className="cursor-pointer text-sm font-medium">
            <Trans comment="展开音色名称编辑、导出和永久删除操作">
              管理音色
            </Trans>
          </summary>
          <div className="space-y-5 pt-4">{management}</div>
        </details>
      )}
    </div>
  );
}
