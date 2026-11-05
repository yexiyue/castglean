import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";
import { AppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useVoiceLibrary } from "@/hooks/use-voice-library";
import type { VoiceTransfers } from "@/hooks/use-voice-transfers";
import { commands } from "@/lib/bindings";
import { voiceFailureMessages } from "@/lib/voice-messages";
import { LibraryVoiceActions } from "./library-voice-actions";
import { VoiceLibraryRows } from "./voice-library-rows";

export function MyVoiceLibrary({
  transfers,
  onImport,
}: {
  transfers: VoiceTransfers;
  onImport: () => void;
}) {
  const { t, i18n } = useLingui();
  const library = useVoiceLibrary(transfers.revision);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const visible = library.voices.filter((voice) =>
    `${voice.name} ${voice.description ?? ""}`
      .toLocaleLowerCase(i18n.locale)
      .includes(query.trim().toLocaleLowerCase(i18n.locale)),
  );
  const selectedIds = library.voices
    .filter((voice) => selected.has(voice.id))
    .map((voice) => voice.id);
  const voice = library.voices.find((item) => item.id === detail);
  let content: ReactNode;
  if (!library.desktop) {
    content = (
      <AppState
        kind="unavailable"
        title={<Trans>请在桌面应用中打开音色库</Trans>}
        description={
          <Trans>浏览器仅提供界面预览，不读取或修改真实音色资产。</Trans>
        }
      />
    );
  } else if (library.loading) {
    content = (
      <p role="status" className="text-muted-foreground text-sm">
        <Trans>正在读取音色库…</Trans>
      </p>
    );
  } else if (library.error) {
    content = (
      <AppState
        kind="error"
        title={<Trans>无法读取音色库</Trans>}
        description={t(
          voiceFailureMessages[library.error.code] ??
            voiceFailureMessages.Unavailable,
        )}
        actions={
          <Button variant="outline" onClick={() => void library.refresh()}>
            <Trans comment="重新读取真实音色库">重试</Trans>
          </Button>
        }
      />
    );
  } else if (library.voices.length === 0) {
    content = (
      <AppState
        title={<Trans>还没有自己的音色</Trans>}
        description={<Trans>导入已有音色包，即可在这里跨工程管理声音。</Trans>}
        actions={
          <Button onClick={onImport}>
            <Trans comment="从空音色库打开批量导入">导入音色包</Trans>
          </Button>
        }
      />
    );
  } else {
    content = (
      <VoiceLibraryRows
        items={visible}
        selected={selected}
        onOpen={setDetail}
        onSelect={(id, checked) =>
          setSelected((previous) => {
            const next = new Set(previous);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          })
        }
      />
    );
  }
  return (
    <>
      <p className="text-muted-foreground text-sm">
        <Trans>
          音色跨模型保存。使用前需检查所选模型是否支持此录音，导入导出无需加载模型。
        </Trans>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-sm"
          aria-label={t({
            comment: "真实音色库搜索框",
            message: "搜索我的音色",
          })}
          placeholder={t({ message: "搜索名称或描述…" })}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">
            <Plural value={selectedIds.length} other="已选择 # 个音色" />
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSelected(
                (previous) =>
                  new Set([...previous, ...visible.map((item) => item.id)]),
              )
            }
          >
            <Trans comment="只选择当前搜索结果中的全部音色">全选搜索结果</Trans>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            <Trans comment="清空真实音色库导出选择">取消全选</Trans>
          </Button>
          <Button
            size="sm"
            disabled={
              !library.desktop || transfers.busy || selectedIds.length === 0
            }
            onClick={() =>
              void transfers.run(() => commands.exportVoiceEntries(selectedIds))
            }
          >
            <Trans comment="将选中的真实音色保存到一个包">导出所选音色</Trans>
          </Button>
        </div>
      </div>
      {deletedName && (
        <p role="status" className="text-muted-foreground text-sm">
          <Trans>已删除音色「{deletedName}」。</Trans>
        </p>
      )}
      {content}
      {library.desktop && library.voices.length > 0 && visible.length === 0 && (
        <AppState
          kind="search"
          title={<Trans>没有匹配的音色</Trans>}
          actions={
            <Button variant="ghost" onClick={() => setQuery("")}>
              <Trans comment="清除音色名称和描述搜索">清除搜索</Trans>
            </Button>
          }
        />
      )}
      {library.diagnostics.map((diagnostic) => (
        <p
          key={diagnostic.id}
          role="alert"
          className="text-destructive text-sm"
        >
          {diagnostic.id} · {t(voiceFailureMessages[diagnostic.error.code])}
        </p>
      ))}
      {voice && (
        <Sheet
          modal={false}
          disablePointerDismissal
          open
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
        >
          <SheetContent
            showOverlay={false}
            className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
            style={{ bottom: "var(--voice-player-inset, 0px)", height: "auto" }}
          >
            <SheetHeader>
              <SheetTitle className="wrap-break-word">{voice.name}</SheetTitle>
              <SheetDescription>
                <Trans>模型无关的音色资产，实际兼容性在使用时验证。</Trans>
              </SheetDescription>
            </SheetHeader>
            <LibraryVoiceActions
              key={voice.id}
              voice={voice}
              exportAction={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={transfers.busy}
                  onClick={() =>
                    void transfers.run(() =>
                      commands.exportVoiceEntries([voice.id]),
                    )
                  }
                >
                  <Trans comment="真实详情单音色导出，复用批量 API">
                    导出音色包
                  </Trans>
                </Button>
              }
              onChanged={library.refresh}
              onDeleted={(name) => {
                setDetail(null);
                setDeletedName(name);
                setSelected((previous) => {
                  const next = new Set(previous);
                  next.delete(voice.id);
                  return next;
                });
              }}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
