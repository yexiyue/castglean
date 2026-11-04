import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  MicIcon,
  UserRoundIcon,
  ArrowLeftRightIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChangeVoiceDialog } from "@/components/projects/change-voice-dialog";
import { useSampleVoiceBindings } from "@/hooks/use-sample-voice-bindings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import { sampleVoiceNames, sampleVoices } from "@/lib/sample-voice-bindings";
import type { SampleVoiceBinding } from "@/lib/sample-voice-bindings";

export function SampleCharacterBindings({ binding }: { binding?: string }) {
  const { t } = useLingui();
  const { workspace } = useDesktopSession();
  const [names] = useWorkspaceState<Record<string, string>>(
    "voice-library",
    "names",
    {},
  );
  const [removed] = useWorkspaceState<string[]>("voice-library", "removed", []);
  const { bindings, changeVoice } = useSampleVoiceBindings();
  const [editing, setEditing] = useState<SampleVoiceBinding | null>(null);
  const [lastChange, setLastChange] = useWorkspaceState<{
    bindingId: string;
    previousId: string;
    nextId: string;
  } | null>("sample", "lastVoiceChange", null);
  const lastBinding = bindings.find(
    (item) => item.id === lastChange?.bindingId,
  );
  const canUndo =
    !!lastChange &&
    lastBinding?.voiceId === lastChange.nextId &&
    !removed.includes(lastChange.previousId);
  const changedRole =
    lastBinding?.kind === "character"
      ? lastBinding.characterName
      : t({ comment: "朗读职能，不是小说人物身份", message: "旁白" });
  const changedVoice = lastChange
    ? (names[lastChange.nextId] ?? sampleVoiceNames[lastChange.nextId])
    : "";
  const selected = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (binding && selected.current) {
      selected.current.focus({ preventScroll: true });
      selected.current.scrollIntoView({ block: "nearest" });
    }
  }, [binding]);
  return (
    <div className="flex flex-col gap-5">
      {binding && (
        <Button
          variant="ghost"
          className="self-start"
          nativeButton={false}
          render={<Link to="/voices" />}
          onClick={() => {
            const target = bindings.find((item) => item.id === binding);
            if (target)
              workspace("voice-library").selectedVoice = target.voiceId;
          }}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          <Trans comment="从示例工程引用位置返回原先打开的音色详情">
            返回音色详情
          </Trans>
        </Button>
      )}
      {lastChange && lastBinding && (
        <div
          role="status"
          className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">
              <Trans comment="预览成功反馈，changedRole 是角色或旁白，changedVoice 是新音色">
                已为「{changedRole}」换用「{changedVoice}」（预览）
              </Trans>
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              <Trans>尚未生成新音频，其他角色绑定保持不变。</Trans>
              {!canUndo && (
                <span className="mt-1 block">
                  <Trans>原音色已移除，无法撤销。</Trans>
                </span>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canUndo}
            onClick={() => {
              if (canUndo) {
                changeVoice(lastChange.bindingId, lastChange.previousId);
                setLastChange(null);
              }
            }}
          >
            <Undo2Icon data-icon="inline-start" />
            <Trans comment="恢复本次预览更换前的声音绑定">撤销更换</Trans>
          </Button>
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>
              <Trans>角色与旁白的声音绑定</Trans>
            </CardTitle>
            <Badge variant="outline">
              <Trans comment="只展示设计用绑定，不是真实工程引用">
                示例引用
              </Trans>
            </Badge>
          </div>
          <CardDescription>
            <Trans>人物身份与音色分别管理，旁白作为独立朗读职能。</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {bindings.map((item) => (
              <li
                key={item.id}
                data-binding-id={item.id}
                data-active={binding === item.id}
                ref={binding === item.id ? selected : undefined}
                tabIndex={-1}
                aria-label={
                  item.kind === "narration"
                    ? t({
                        comment: "朗读职能，不是小说人物身份",
                        message: "旁白",
                      })
                    : item.characterName
                }
                className="data-[active=true]:bg-accent focus-visible:ring-ring flex flex-wrap items-center gap-4 rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset"
              >
                <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  {item.kind === "narration" ? (
                    <MicIcon className="size-4" />
                  ) : (
                    <UserRoundIcon className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {item.kind === "narration" ? (
                      <Trans comment="朗读职能，不是小说人物身份">旁白</Trans>
                    ) : (
                      item.characterName
                    )}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {item.kind === "narration" ? (
                      <Trans comment="旁白属于朗读职能，不计为人物">
                        朗读职能
                      </Trans>
                    ) : (
                      <Trans comment="小说中有独立稳定身份的人物">
                        人物角色
                      </Trans>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {removed.includes(item.voiceId) ? (
                    <Badge variant="outline">
                      <Trans>音色已从预览移除</Trans>
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={<Link to="/voices" />}
                      onClick={() => {
                        workspace("voice-library").selectedVoice = item.voiceId;
                      }}
                      aria-label={t({
                        comment:
                          "进入所选绑定对应的音色详情，名称可在预览中编辑",
                        message: `查看音色：${names[item.voiceId] ?? sampleVoiceNames[item.voiceId]}`,
                      })}
                    >
                      <span className="max-w-40 truncate">
                        {names[item.voiceId] ?? sampleVoiceNames[item.voiceId]}
                      </span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-change-binding={item.id}
                    onClick={() => setEditing(item)}
                    aria-label={t({
                      comment: "打开角色或旁白的声音更换流程",
                      message: `更换音色：${item.kind === "character" ? item.characterName : t({ comment: "朗读职能，不是小说人物身份", message: "旁白" })}`,
                    })}
                  >
                    <ArrowLeftRightIcon data-icon="inline-start" />
                    <Trans comment="先选择新声音，再确认影响范围">
                      更换音色
                    </Trans>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-5 text-xs leading-5">
            <Trans>仅展示示例绑定，真实工程引用尚未接入。</Trans>
          </p>
        </CardContent>
      </Card>
      {editing && (
        <ChangeVoiceDialog
          key={editing.id}
          binding={editing}
          names={names}
          removed={removed}
          onClose={() => setEditing(null)}
          onConfirm={(voiceId) => {
            const current = bindings.find((item) => item.id === editing.id);
            if (
              !current ||
              current.voiceId !== editing.voiceId ||
              voiceId === current.voiceId ||
              removed.includes(voiceId) ||
              !sampleVoices.some(
                (voice) =>
                  voice.id === voiceId &&
                  voice.modelId ===
                    (sampleVoices.find(
                      (source) => source.id === current.voiceId,
                    )?.modelId ?? "preview-preset"),
              )
            )
              return false;
            changeVoice(editing.id, voiceId);
            setLastChange({
              bindingId: editing.id,
              previousId: editing.voiceId,
              nextId: voiceId,
            });
            setEditing(null);
            return true;
          }}
        />
      )}
    </div>
  );
}
