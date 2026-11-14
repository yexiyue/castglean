import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { AppState } from "@/components/app-state";
import { DetailHero } from "@/components/detail-hero";
import type { ListView } from "@/components/list-view-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { useVoiceLibrary } from "@/hooks/use-voice-library";
import type { VoiceTransfers } from "@/hooks/use-voice-transfers";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { VoiceEditOperations } from "@/lib/voice-edit-operations";
import { voiceFailureMessages } from "@/lib/voice-messages";
import { formatVoiceDuration, formatVoiceSize } from "@/lib/voices";
import { LibraryVoiceActions } from "./library-voice-actions";
import { VoiceLibraryRows } from "./voice-library-rows";

export function MyVoiceLibrary({
  transfers,
  view = "table",
  viewControl,
  onImport,
}: {
  transfers: VoiceTransfers;
  view?: ListView;
  viewControl?: ReactNode;
  onImport: () => void;
}) {
  const { t, i18n } = useLingui();
  const { workspace } = useDesktopSession();
  const operations = useMemo(() => {
    const values = workspace("voices");
    if (!(values.editOperations instanceof VoiceEditOperations))
      values.editOperations = new VoiceEditOperations();
    return values.editOperations as VoiceEditOperations;
  }, [workspace]);
  const library = useVoiceLibrary(transfers.revision);
  useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  const completedEdits = useSyncExternalStore(
    operations.subscribe,
    operations.completionSnapshot,
    operations.completionSnapshot,
  );
  useEffect(() => {
    if (completedEdits) void library.refresh();
  }, [completedEdits, library.refresh]);
  const [query, setQuery] = useState("");
  const selection = useForm<{ ids: string[] }>({ defaultValues: { ids: [] } });
  const selected = new Set(selection.watch("ids"));
  const [detail, setDetail] = useState<string | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const [deletionCount, setDeletionCount] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!deletionCount) return;
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [deletionCount]);
  const [missingRecovery, setMissingRecovery] = useState<string | null>(null);
  const [missingRecoveryFailed, setMissingRecoveryFailed] = useState<
    string | null
  >(null);
  const visible = library.voices.filter((voice) =>
    `${voice.name} ${voice.description ?? ""}`
      .toLocaleLowerCase(i18n.locale)
      .includes(query.trim().toLocaleLowerCase(i18n.locale)),
  );
  const selectedIds = library.voices
    .filter((voice) => selected.has(voice.id))
    .map((voice) => voice.id);
  const voice = library.voices.find((item) => item.id === detail);
  const importedDate = (seconds: number | null) => {
    if (seconds === null || !Number.isFinite(seconds)) return null;
    const value = new Date(seconds * 1000);
    return Number.isNaN(value.getTime())
      ? null
      : value.toLocaleDateString(i18n.locale);
  };
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
      <Controller
        control={selection.control}
        name="ids"
        render={({ field }) => (
          <VoiceLibraryRows
            resetKey={query.trim()}
            items={visible.map((item) => ({
              ...item,
              sourceDetail: importedDate(item.imported_at),
            }))}
            view={view}
            selected={new Set(field.value)}
            onOpen={setDetail}
            onSelect={(id, checked) => {
              const next = new Set(field.value);
              if (checked) next.add(id);
              else next.delete(id);
              field.onChange([...next]);
            }}
          />
        )}
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          ref={searchInput}
          className="max-w-sm"
          aria-label={t({
            comment: "真实音色库搜索框",
            message: "搜索我的音色",
          })}
          placeholder={t({ message: "搜索名称或描述…" })}
          value={query}
          onValueChange={setQuery}
        />
        {library.voices.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 ? (
              <span className="text-muted-foreground text-xs">
                <Plural value={selectedIds.length} other="已选择 # 个音色" />
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                selection.setValue("ids", [
                  ...new Set([
                    ...selection.getValues("ids"),
                    ...visible.map((item) => item.id),
                  ]),
                ])
              }
            >
              <Trans comment="只选择当前搜索结果中的全部音色">
                全选搜索结果
              </Trans>
            </Button>
            {selectedIds.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => selection.setValue("ids", [])}
              >
                <Trans comment="清空真实音色库导出选择">取消全选</Trans>
              </Button>
            ) : null}
            {selectedIds.length > 0 && (
              <Button
                size="sm"
                disabled={
                  !library.desktop || transfers.busy || selectedIds.length === 0
                }
                onClick={() =>
                  void transfers.run(() =>
                    commands.exportVoiceEntries(selectedIds),
                  )
                }
              >
                <Trans comment="将选中的真实音色保存到一个包">
                  导出所选音色
                </Trans>
              </Button>
            )}
          </div>
        ) : null}
        {viewControl}
      </div>
      {deletedName && (
        <p role="status" className="text-muted-foreground text-sm">
          <Trans>已删除音色「{deletedName}」。</Trans>
        </p>
      )}
      {operations.unknownIds().map((id) => {
        const target = library.voices.find((item) => item.id === id);
        const label = target?.name ?? id;
        return (
          <div
            key={id}
            role="status"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span>
              {operations.unknownEdit(id)?.phase === "read" ? (
                <Trans>音色「{label}」的修改已确认，待读取当前音色。</Trans>
              ) : (
                <Trans>音色「{label}」的修改尚未确认。</Trans>
              )}
            </span>
            {target ? (
              <Button size="sm" variant="outline" onClick={() => setDetail(id)}>
                <Trans>查看音色，在管理音色中核对</Trans>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={missingRecovery === id}
                onClick={() => {
                  setMissingRecovery(id);
                  setMissingRecoveryFailed(null);
                  void commands
                    .listLibraryVoices()
                    .then((inventory) => {
                      if (
                        inventory.diagnostics.some(
                          (diagnostic) => diagnostic.id === id,
                        )
                      )
                        throw new Error("voice_unavailable");
                      if (!inventory.voices.some((item) => item.id === id)) {
                        operations.abandonUnknown(id);
                        operations.clearDraft(id);
                      }
                      library.acceptInventory(inventory);
                    })
                    .catch(() => setMissingRecoveryFailed(id))
                    .finally(() => setMissingRecovery(null));
                }}
              >
                <Trans>重新读取并放弃此音色草稿</Trans>
              </Button>
            )}
            {missingRecoveryFailed === id && (
              <span role="alert">
                <Trans>无法确认音色状态，请重试。</Trans>
              </span>
            )}
          </div>
        );
      })}
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
      <p className="text-muted-foreground text-xs leading-5">
        <Trans>
          音色跨模型保存。使用前需检查所选模型是否支持此录音，导入导出无需加载模型。
        </Trans>
      </p>
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
        >
          <DialogContent padding="none" className="sm:max-w-lg">
            {/* Hero 卡头：音色标识 + 名称 + 库内徽章 + 来源与录音规格，与模型中心详情同构。 */}
            <DetailHero>
              <div className="flex min-w-0 items-center gap-3 pr-8">
                <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-xl">
                  <AudioLinesIcon aria-hidden="true" className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="wrap-break-word">
                    {voice.name}
                  </DialogTitle>
                  <DialogDescription>
                    <Trans>模型无关的音色资产，实际兼容性在使用时验证。</Trans>
                  </DialogDescription>
                </div>
                <Badge variant="outline">
                  <Trans comment="用户保存到本机音色库的模型无关资产">
                    库内音色
                  </Trans>
                </Badge>
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums">
                {voice.source?.trim() ? (
                  <span className="wrap-anywhere">{voice.source.trim()}</span>
                ) : null}
                <span>
                  {`${
                    formatVoiceDuration(voice.duration, i18n.locale) ?? "—"
                  } s · ${formatVoiceSize(voice.bytes, i18n.locale)}`}
                </span>
              </div>
            </DetailHero>
            <LibraryVoiceActions
              key={voice.id}
              voice={voice}
              operations={operations}
              draft={operations.draft(voice.id)}
              onDraftChange={(field, value, expected) =>
                operations.setDraft(voice.id, field, value, expected)
              }
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
              onChanged={() => library.refresh(true)}
              onReconciled={(inventory) => {
                library.acceptInventory(inventory);
                setDetail(null);
              }}
              onDeleted={(name) => {
                operations.clearDraft(voice.id);
                setDetail(null);
                setDeletedName(name);
                setDeletionCount((count) => count + 1);
                selection.setValue(
                  "ids",
                  selection.getValues("ids").filter((id) => id !== voice.id),
                );
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
