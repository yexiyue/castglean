import type { Interrupt } from "@ag-ui/core";
import {
  useAgUiInterrupts,
  useAgUiSubmitInterruptResponses,
} from "@assistant-ui/react-ag-ui";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { commands } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";

const itemSchema = z.object({
  id: z.string(),
  targetName: z.string(),
  text: z.string(),
  resource: z.unknown(),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("directory"),
      label: z.string(),
      model: z.string(),
      backend: z.string(),
      device: z.string(),
    }),
    z.object({
      kind: z.literal("design"),
      engine: z.string(),
      description: z.string(),
      device: z.string(),
    }),
  ]),
});
const metadataSchema = z.object({
  retry: z.boolean().optional(),
  castingAuditionPlan: z.object({ items: z.array(itemSchema).min(1) }),
});

type Decision =
  | { decision: "approve"; items: { id: string; text: string }[] }
  | { decision: "reject"; feedback: string };

export function CastingApproval({
  projectId,
  interrupt,
  blocked,
  accept,
}: {
  projectId: string;
  interrupt: Interrupt;
  blocked: boolean;
  accept: (submit: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useLingui();
  const submit = useAgUiSubmitInterruptResponses();
  const ready = useAgUiInterrupts().some((value) => value.id === interrupt.id);
  const [draft, setDraft] = useWorkspaceState<{
    selected: Record<string, boolean>;
    texts: Record<string, string>;
    feedback: string;
  }>(projectId, `castingApproval:${interrupt.id}`, {
    selected: {},
    texts: {},
    feedback: "",
  });
  const [readyItems, setReadyItems] = useState<Set<string> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const parsed = metadataSchema.safeParse(interrupt.metadata);
  if (!parsed.success) {
    return (
      <p role="status" className="text-muted-foreground">
        <Trans>无法读取试听计划。</Trans>
      </p>
    );
  }

  const { items } = parsed.data.castingAuditionPlan;
  const retry = parsed.data.retry;
  const busy = blocked || !ready || sending || refreshing;
  const isReady = (item: z.infer<typeof itemSchema>) =>
    readyItems?.has(item.id) ?? item.resource === "Ready";

  async function refreshResources() {
    setRefreshing(true);
    setFailed(false);
    try {
      const [models, designers] = await Promise.all([
        commands.listModels(),
        commands.listDesignEngines(),
      ]);
      setReadyItems(
        new Set(
          items
            .filter(({ source }) => {
              if (source.kind === "directory") {
                return models.some(
                  (model) =>
                    model.backend === source.backend &&
                    model.model === source.model &&
                    model.resource === "Ready" &&
                    model.available_devices.some(
                      (device) => device === source.device,
                    ),
                );
              }
              return designers.some(
                (designer) =>
                  designer.id === source.engine &&
                  designer.ready &&
                  designer.devices.some((device) => device === source.device),
              );
            })
            .map((item) => item.id),
        ),
      );
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }
  const selected = items
    .filter((item) => isReady(item) && draft.selected[item.id])
    .map((item) => ({
      id: item.id,
      text: (draft.texts[item.id] ?? item.text).trim(),
    }));

  async function send(payload: Decision) {
    setSending(true);
    setFailed(false);
    try {
      await accept(() =>
        submit([{ interruptId: interrupt.id, status: "resolved", payload }]),
      );
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <fieldset className="space-y-3 px-4 py-3" disabled={busy}>
      <legend className="text-sm font-medium">
        {retry ? <Trans>重试未完成的试听</Trans> : <Trans>批准选角试听</Trans>}
      </legend>
      <ul className="divide-y">
        {items.map((item) => {
          const source = item.source;
          const resource = isReady(item);
          const text = draft.texts[item.id] ?? item.text;
          return (
            <li key={item.id} className="min-w-0 space-y-2 py-3 text-sm">
              <label
                htmlFor={`casting-${interrupt.id}-${item.id}`}
                className="flex min-h-8 items-center gap-2 font-medium"
              >
                <Checkbox
                  id={`casting-${interrupt.id}-${item.id}`}
                  checked={!!draft.selected[item.id]}
                  disabled={busy || !resource}
                  onCheckedChange={(checked) => {
                    setDraft((value) => ({
                      ...value,
                      selected: { ...value.selected, [item.id]: checked },
                    }));
                  }}
                />
                <span>{item.targetName}</span>
              </label>
              <p className="text-xs wrap-anywhere text-muted-foreground">
                {source.kind === "directory"
                  ? `${source.label} · ${source.backend} / ${source.model} · ${source.device}`
                  : `${source.engine} · ${source.device} · ${source.description}`}
              </p>
              {resource ? null : (
                <p className="text-xs text-muted-foreground">
                  <Trans>试听模型资源尚未就绪。</Trans>
                </p>
              )}
              <Textarea
                aria-label={t`${item.targetName}的试听文本`}
                value={text}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) => ({
                    ...previous,
                    texts: { ...previous.texts, [item.id]: value },
                  }));
                }}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        {items.some((item) => !isReady(item)) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refreshResources()}
          >
            <Trans>刷新</Trans>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft((value) => ({
              ...value,
              selected: Object.fromEntries(
                items.map((item) => [item.id, isReady(item)]),
              ),
            }));
          }}
        >
          <Trans>选择全部可试听项</Trans>
        </Button>
        <Button
          size="sm"
          disabled={!selected.length || selected.some((item) => !item.text)}
          onClick={() => void send({ decision: "approve", items: selected })}
        >
          <Trans>批准所选试听</Trans>
        </Button>
      </div>
      {retry ? null : (
        <Textarea
          aria-label={t`拒绝试听的反馈`}
          placeholder={t`反馈（选填）`}
          value={draft.feedback}
          onChange={(event) => {
            const feedback = event.target.value;
            setDraft((previous) => ({ ...previous, feedback }));
          }}
        />
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void send({ decision: "reject", feedback: draft.feedback })
        }
      >
        {retry ? <Trans>跳过并发布建议</Trans> : <Trans>拒绝试听计划</Trans>}
      </Button>
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          <Trans>决定未能提交。请核对试听文本、音色与模型状态后重试。</Trans>
        </p>
      ) : null}
    </fieldset>
  );
}
