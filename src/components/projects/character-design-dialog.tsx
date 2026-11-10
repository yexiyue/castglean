import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { DesignDraft, InferenceDevice } from "@/lib/bindings";
import { AUDITION_TEXT } from "@/lib/voice-audition";

export function CharacterDesignDialog({
  targetLabel,
  initial,
  studio,
  onClose,
}: {
  targetLabel: string;
  initial: DesignDraft;
  studio: VoiceStudio;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [name, setName] = useState(targetLabel);
  const [description, setDescription] = useState(initial.prompt);
  const [text, setText] = useState(AUDITION_TEXT);
  const [engineId, setEngineId] = useState(initial.engine ?? "");
  const engine =
    studio.engines.find((e) => e.id === engineId) ??
    studio.engines.find((e) => e.ready && e.devices.length > 0) ??
    studio.engines[0];
  const [deviceId, setDeviceId] = useState<string>("");
  const device = (engine?.devices.find((d) => d === deviceId) ??
    engine?.devices[0]) as InferenceDevice | undefined;
  useEffect(() => setDeviceId(device ?? ""), [device]);
  const valid =
    !!engine &&
    engine.ready &&
    !!device &&
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    text.trim().length > 0 &&
    (!engine.text_max_chars || [...text].length <= engine.text_max_chars);
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[80vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            <Trans>为「{targetLabel}」设计音色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>生成候选后需试听并确认入库（描述必填），再回到绑定。</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="design-name">
                <Trans>音色名称</Trans>
              </FieldLabel>
              <Input
                id="design-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="design-description">
                <Trans>声音描述</Trans>
              </FieldLabel>
              <Textarea
                id="design-description"
                className="min-h-20"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="design-engine">
                <Trans>设计引擎</Trans>
              </FieldLabel>
              <NativeSelect
                id="design-engine"
                value={engine?.id ?? ""}
                onChange={(e) => {
                  setEngineId(e.target.value);
                  setDeviceId("");
                }}
                disabled={!engine?.ready}
              >
                {studio.engines.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.ready ? "" : t`（未就绪）`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {engine?.devices.length ? (
              <Field>
                <FieldLabel htmlFor="design-device">
                  <Trans>计算设备</Trans>
                </FieldLabel>
                <NativeSelect
                  id="design-device"
                  value={device ?? ""}
                  onChange={(e) => setDeviceId(e.target.value)}
                >
                  {engine.devices.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="design-text">
                <Trans>试音文本</Trans>
              </FieldLabel>
              <Textarea
                id="design-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
          </FieldGroup>
        </div>
        <div className="flex items-center gap-2">
          <Button
            disabled={!studio.desktop || studio.pending || !valid}
            onClick={() => {
              if (engine && device)
                void studio.start({
                  kind: "design",
                  engine: engine.id,
                  device,
                  name: name.trim(),
                  description: description.trim(),
                  text,
                  seed: null,
                });
              onClose();
            }}
          >
            <Trans>生成音色候选</Trans>
          </Button>
          <Button variant="ghost" onClick={onClose}>
            <Trans>取消</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
