import { Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon, FileAudioIcon, FingerprintIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import {
  Property,
  PropertyGroup,
  SectionTag,
} from "@/components/detail-properties";
import { Button } from "@/components/ui/button";
import type { LibraryVoice } from "@/lib/bindings";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";

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
    <div className="flex flex-col gap-4" data-slot="voice-properties">
      <PropertyGroup
        title={<Trans comment="库内音色的内容与来源分组">声音资产</Trans>}
        icon={AudioLinesIcon}
      >
        <Property
          label={<Trans comment="音色详情中的声音描述">声音描述</Trans>}
        >
          {voice.description?.trim() || "—"}
        </Property>
        <Property
          label={<Trans comment="声音的来源引擎或用户录音">来源</Trans>}
        >
          {voice.source?.trim() || "—"}
        </Property>
      </PropertyGroup>
      <PropertyGroup
        title={<Trans comment="库内音色的原始录音规格分组">录音信息</Trans>}
        icon={FileAudioIcon}
      >
        <Property label={<Trans comment="音色原始录音长度">录音时长</Trans>}>
          {duration === null ? "—" : <Trans>{duration} 秒</Trans>}
        </Property>
        <Property
          label={<Trans comment="音色原始录音占用的存储空间">录音大小</Trans>}
        >
          {formatVoiceSize(voice.bytes, i18n.locale)}
        </Property>
      </PropertyGroup>
      <PropertyGroup
        title={<Trans comment="音色的稳定标识与时间记录分组">标识</Trans>}
        icon={FingerprintIcon}
      >
        <Property
          secondary
          label={<Trans comment="稳定音色 ID 字段">音色身份</Trans>}
        >
          {voice.id}
        </Property>
        <Property
          secondary
          label={
            <Trans comment="音色资产首次创建的时间，导入时保留">
              原始创建时间
            </Trans>
          }
        >
          {date(voice.created_at)}
        </Property>
        <Property
          secondary
          label={
            <Trans comment="音色导入本设备音色库的时间">本机入库时间</Trans>
          }
        >
          {date(voice.imported_at)}
        </Property>
      </PropertyGroup>
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTag icon={FileAudioIcon}>
          <Trans comment="库内音色的原始声音及其准确参考文本">原始录音</Trans>
        </SectionTag>
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
      className="flex flex-col gap-4 px-5 pt-4"
      style={{ paddingBottom: "max(3rem, var(--voice-player-inset, 0px))" }}
    >
      {properties}
      {reference && (
        <section className="flex flex-col gap-3">{reference}</section>
      )}
      <section className="flex flex-col gap-4">
        {audition}
        {results}
      </section>
      {management && (
        <AuxiliaryDialog
          title={
            <>
              {" "}
              <Trans comment="展开音色名称编辑、导出和永久删除操作">
                管理音色
              </Trans>{" "}
            </>
          }
        >
          <div className="space-y-5 pt-4">{management}</div>
        </AuxiliaryDialog>
      )}
    </div>
  );
}
