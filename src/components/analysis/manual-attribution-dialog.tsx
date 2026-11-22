import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  type ByteRange,
  type Character,
  commands,
  type Edit,
  type ManualSpeaker,
  type SourceBinding,
} from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";

export type ManualAttributionRequest = {
  source: SourceBinding;
  revision: number;
} & (
  | {
      kind: "assign";
      range: ByteRange;
      text: string;
      replacesAttribution: boolean;
    }
  | { kind: "fill" }
  | { kind: "undo" }
);

type ManualAttributionDialogProps = {
  request: ManualAttributionRequest;
  characters: Character[];
  onClose: () => void;
  onSaved: (revision: number) => Promise<void>;
  returnFocus: () => HTMLElement | null;
};

type SaveFailure = "write" | "read" | "conflict";
type SaveOperation = {
  commandId: string;
  edit: Edit;
  savedRevision: number | null;
};

export function ManualAttributionDialog({
  request,
  characters,
  onClose,
  onSaved,
  returnFocus,
}: ManualAttributionDialogProps) {
  const { t } = useLingui();
  const searchId = useId();
  const nameId = useId();
  const [kind, setKind] = useState<"speech" | "thought" | "narration">(
    "speech",
  );
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [operation, setOperation] = useWorkspaceState<SaveOperation | null>(
    request.source.projectId,
    `manual-attribution-operation:${request.source.chapterId}`,
    null,
  );
  const [failure, setFailure] = useState<SaveFailure | null>(() => {
    if (!operation) return null;
    return operation.savedRevision === null ? "write" : "read";
  });
  const [busy, setBusy] = useState(false);
  const canClose = !busy && failure !== "write" && failure !== "read";
  const saveActive = useRef(false);
  const displayName = name.trim();
  const searchTerm = search.trim().toLocaleLowerCase();
  const matchingCharacters = characters.filter(
    (character) =>
      character.id === role ||
      character.displayName.toLocaleLowerCase().includes(searchTerm),
  );
  const duplicate =
    displayName.length > 0 &&
    characters.some((character) => character.displayName === displayName);
  const canSave =
    !!operation ||
    request.kind !== "assign" ||
    kind === "narration" ||
    (role === "new" ? displayName.length > 0 : role !== "");

  function createEdit(): Edit {
    switch (request.kind) {
      case "undo":
        return { type: "undo" };
      case "fill":
        return { type: "fill_narrator", source: request.source };
      case "assign": {
        let speaker: ManualSpeaker;
        if (kind === "narration") speaker = { type: "narrator" };
        else if (role === "new") speaker = { type: "new", name: displayName };
        else speaker = { type: "existing", character_id: role };

        return {
          type: "assign_range",
          source: request.source,
          range: request.range,
          kind,
          speaker,
        };
      }
    }
  }

  async function save(): Promise<void> {
    if (saveActive.current || !canSave || failure === "conflict") return;
    saveActive.current = true;
    setBusy(true);
    setFailure(null);
    const { source } = request;
    const pending = operation ?? {
      commandId: crypto.randomUUID(),
      edit: createEdit(),
      savedRevision: null,
    };
    let savedRevision = pending.savedRevision;
    setOperation(pending);
    try {
      if (savedRevision === null) {
        const receipt = await commands.chapterAnalysisEdit(
          source.projectId,
          source.chapterId,
          pending.commandId,
          request.revision,
          pending.edit,
        );
        savedRevision = receipt.revision;
        setOperation({ ...pending, savedRevision });
      }
      await onSaved(savedRevision);
      setOperation(null);
      onClose();
    } catch (error) {
      if (savedRevision !== null) {
        setFailure("read");
      } else if (
        error === "conflict" ||
        error === "source_changed" ||
        error === "invalid_data"
      ) {
        setOperation(null);
        setFailure("conflict");
      } else {
        setFailure("write");
      }
    } finally {
      saveActive.current = false;
      setBusy(false);
    }
  }
  const titles = {
    assign: t`归属给角色`,
    fill: t`将未标注段设为旁白`,
    undo: t`撤回本章上次归属修改`,
  };
  const failureMessages = {
    read: t`归属已保存，读取结果失败。`,
    conflict: t`无法保存到当前版本，请关闭后重新选择原文。`,
    write: t`尚未确认归属是否保存。重试会沿用原操作。`,
  };
  let saveLabel = request.kind === "undo" ? t`确认撤回` : t`保存归属`;
  if (failure === "read") saveLabel = t`重试读取`;
  if (failure === "write") saveLabel = t`重试原操作`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && canClose) onClose();
      }}
    >
      <DialogContent
        finalFocus={() => returnFocus() ?? false}
        showCloseButton={canClose}
      >
        <DialogTitle>{titles[request.kind]}</DialogTitle>
        <DialogDescription>
          {request.kind === "undo" ? (
            <Trans>恢复本章上次归属修改前的版本。</Trans>
          ) : request.kind === "fill" ? (
            <Trans>只会处理本章尚未标注的原文，已有归属会保留。</Trans>
          ) : (
            <span className="line-clamp-4 whitespace-pre-wrap">
              {request.text}
            </span>
          )}
        </DialogDescription>
        {request.kind === "assign" && (
          <div className="grid gap-3">
            {request.replacesAttribution && (
              <p className="text-sm text-muted-foreground">
                <Trans>保存后，选区内的已有归属会更新。</Trans>
              </p>
            )}
            <label className="grid gap-1">
              <span>
                <Trans comment="Narration, dialogue or inner monologue for a manuscript selection">
                  片段类型
                </Trans>
              </span>
              <NativeSelect
                value={kind}
                disabled={busy || !!failure}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    value === "speech" ||
                    value === "thought" ||
                    value === "narration"
                  )
                    setKind(value);
                }}
              >
                <option value="speech">{t`台词`}</option>
                <option value="thought">{t`内心独白`}</option>
                <option value="narration">{t`旁白`}</option>
              </NativeSelect>
            </label>
            {kind !== "narration" && characters.length > 0 && (
              <label className="grid gap-1" htmlFor={searchId}>
                <span>
                  <Trans>搜索角色</Trans>
                </span>
                <Input
                  id={searchId}
                  value={search}
                  disabled={busy || !!failure}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            )}
            {kind !== "narration" && (
              <label className="grid gap-1">
                <span>
                  <Trans>说话人</Trans>
                </span>
                <NativeSelect
                  value={role}
                  disabled={busy || !!failure}
                  onChange={(event) => setRole(event.target.value)}
                >
                  <option value="" disabled>{t`选择角色`}</option>
                  {matchingCharacters.map((character) => (
                    <option value={character.id} key={character.id}>
                      {character.displayName}
                    </option>
                  ))}
                  <option value="new">{t`新建角色`}</option>
                </NativeSelect>
              </label>
            )}
            {role === "new" && kind !== "narration" && (
              <label className="grid gap-1" htmlFor={nameId}>
                <span>
                  <Trans>角色名称</Trans>
                </span>
                <Input
                  id={nameId}
                  value={name}
                  disabled={busy || !!failure}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                />
                {duplicate && (
                  <span className="text-xs text-muted-foreground">
                    <Trans>
                      已有同名角色。保存会创建独立角色，也可以在列表中选择已有角色。
                    </Trans>
                  </span>
                )}
              </label>
            )}
          </div>
        )}
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failureMessages[failure]}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!canClose} onClick={onClose}>
            <Trans>取消</Trans>
          </Button>
          <Button
            disabled={busy || !canSave || failure === "conflict"}
            onClick={() => void save()}
          >
            {saveLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
