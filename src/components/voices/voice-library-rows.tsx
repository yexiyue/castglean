import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";

export type VoiceListItem = {
  id: string;
  name: string;
  description?: string | null;
  source?: string | null;
  duration?: number | null;
  bytes?: number | null;
};

export function VoiceLibraryRows({
  items,
  preset = false,
  selected,
  onSelect,
  onOpen,
}: {
  items: VoiceListItem[];
  preset?: boolean;
  selected?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
  onOpen?: (id: string) => void;
}) {
  const { t, i18n } = useLingui();
  const columns = preset
    ? "@min-[700px]:grid-cols-[minmax(0,1fr)_12rem_6rem]"
    : "@min-[700px]:grid-cols-[minmax(0,1fr)_8rem_5rem_6rem_6rem]";
  if (!items.length) return null;
  return (
    <div className="@container min-w-0 border-y">
      <div
        aria-hidden="true"
        className={`text-muted-foreground hidden gap-4 border-b px-3 py-2 text-xs @min-[700px]:grid ${columns}`}
      >
        <span>
          <Trans comment="音色列表的名称与描述列">音色</Trans>
        </span>
        <span>
          {preset ? (
            <Trans comment="预置音色所属的语音模型">所属模型</Trans>
          ) : (
            <Trans comment="声音的来源引擎或用户录音">来源</Trans>
          )}
        </span>
        {!preset && (
          <>
            <span>
              <Trans comment="音色原始录音长度">录音时长</Trans>
            </span>
            <span>
              <Trans comment="音色原始录音占用的存储空间">录音大小</Trans>
            </span>
          </>
        )}
        <span className="text-right">
          <Trans comment="音色列表中打开详情或试听的操作列">操作</Trans>
        </span>
      </div>
      <ul
        className="divide-y"
        aria-label={
          preset ? t({ message: "预置音色" }) : t({ message: "我的音色" })
        }
      >
        {items.map((item) => {
          const duration = formatVoiceDuration(item.duration, i18n.locale);
          return (
            <li
              key={item.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 px-3 py-4 @min-[700px]:items-center ${columns}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                {selected && (
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={selected.has(item.id)}
                    disabled={!onSelect}
                    aria-label={t({
                      message: `选择音色「${item.name}」`,
                      comment: "音色列表的批量导出选择框，包含音色名",
                    })}
                    onChange={(event) =>
                      onSelect?.(item.id, event.target.checked)
                    }
                  />
                )}
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium wrap-anywhere">
                    {item.name}
                  </p>
                  {!preset && (
                    <p className="text-muted-foreground text-xs leading-5 wrap-anywhere">
                      {item.description?.trim() || "—"}
                    </p>
                  )}
                </div>
              </div>
              <dl
                className={`col-span-2 row-start-2 grid gap-3 text-sm @min-[700px]:contents ${preset ? "grid-cols-1" : "grid-cols-3"}`}
              >
                <div className="min-w-0 space-y-1">
                  <dt className="text-muted-foreground text-xs @min-[700px]:sr-only">
                    {preset ? (
                      <Trans comment="预置音色所属的语音模型">所属模型</Trans>
                    ) : (
                      <Trans comment="声音的来源引擎或用户录音">来源</Trans>
                    )}
                  </dt>
                  <dd className="wrap-anywhere">
                    {item.source?.trim() || "—"}
                  </dd>
                </div>
                {!preset && (
                  <>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-muted-foreground text-xs @min-[700px]:sr-only">
                        <Trans comment="音色原始录音长度">录音时长</Trans>
                      </dt>
                      <dd className="wrap-anywhere tabular-nums">
                        {duration === null ? "—" : `${duration} s`}
                      </dd>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-muted-foreground text-xs @min-[700px]:sr-only">
                        <Trans comment="音色原始录音占用的存储空间">
                          录音大小
                        </Trans>
                      </dt>
                      <dd className="wrap-anywhere tabular-nums">
                        {formatVoiceSize(item.bytes, i18n.locale)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <Button
                size="sm"
                variant="outline"
                className="col-start-2 row-start-1 justify-self-end @min-[700px]:col-start-auto @min-[700px]:row-start-auto"
                disabled={!onOpen}
                onClick={() => onOpen?.(item.id)}
                aria-label={
                  preset
                    ? t({
                        message: `试听音色「${item.name}」`,
                        comment: "打开指定预置音色的模型试听面板",
                      })
                    : t({
                        message: `查看音色「${item.name}」`,
                        comment: "打开指定库内音色的详情面板",
                      })
                }
              >
                {preset ? (
                  <Trans comment="展开真实预置声音的合成试听">试听声音</Trans>
                ) : (
                  <Trans comment="打开真实音色资产详情">查看详情</Trans>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
