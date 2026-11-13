import { Trans } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChapterPauseEdit } from "@/lib/bindings";

/** The same editor serves source markers and track boundaries. */
export function ChapterPauseEditor({
  afterIndex,
  seconds,
  savedDurationMs,
  boundaries,
  occupied,
  busy,
  onSeconds,
  onEdit,
  onSelect,
  onClose,
}: {
  afterIndex: number;
  seconds: string;
  savedDurationMs: number;
  boundaries: number[];
  occupied: number[];
  busy: boolean;
  onSeconds: (value: string) => void;
  onEdit: (edit: ChapterPauseEdit) => Promise<boolean>;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    if (Math.round(Number(seconds) * 1000) === savedDurationMs)
      setFailed(false);
  }, [seconds, savedDurationMs]);
  async function save() {
    const ms = Math.round(Number(seconds) * 1000);
    if (
      busy ||
      saving.current ||
      seconds.trim() === "" ||
      !Number.isFinite(ms) ||
      ms < 0 ||
      ms > 10000 ||
      ms === savedDurationMs
    )
      return;
    saving.current = true;
    try {
      setFailed(
        !(await onEdit({
          kind: "set",
          after_index: afterIndex,
          duration_ms: ms,
        })),
      );
    } finally {
      saving.current = false;
    }
  }
  return (
    <form
      className="flex flex-col items-start gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor={`${id}-seconds`}>
        <Trans>额外停顿（秒）</Trans>
      </label>
      <Input
        id={`${id}-seconds`}
        className="w-24"
        type="number"
        min="0"
        max="10"
        step="0.01"
        required
        disabled={busy}
        onBlur={() => void save()}
        value={seconds}
        onChange={(e) => onSeconds(e.target.value)}
      />
      {Number(seconds) * 1000 !== savedDurationMs && (
        <p className="text-muted-foreground text-xs">
          <Trans>输入尚未保存，当前为 {savedDurationMs / 1000} 秒</Trans>
        </p>
      )}
      {failed && (
        <Button size="sm" type="submit" variant="outline" disabled={busy}>
          <Trans>重试保存停顿</Trans>
        </Button>
      )}
      {busy && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>正在保存…</Trans>
        </p>
      )}
      <label htmlFor={`${id}-boundary`}>
        <Trans>移动到片段之后</Trans>
      </label>
      <NativeSelect
        id={`${id}-boundary`}
        value={afterIndex}
        disabled={busy}
        onChange={(e) => {
          const to = Number(e.target.value);
          if (to !== afterIndex)
            void onEdit({
              kind: "move",
              after_index: afterIndex,
              to_index: to,
            }).then((saved) => {
              if (saved) onSelect(to);
            });
        }}
      >
        {boundaries.map((index) => (
          <option
            key={index}
            value={index}
            disabled={index !== afterIndex && occupied.includes(index)}
          >
            {index + 1}
          </option>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          void onEdit({
            kind: "set",
            after_index: afterIndex,
            duration_ms: 0,
          }).then((saved) => {
            if (saved) onClose();
          })
        }
      >
        <Trans>删除停顿</Trans>
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={onClose}>
        <Trans>关闭</Trans>
      </Button>
    </form>
  );
}
