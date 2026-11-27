import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import type {
  ChapterAudioDeviceChoice,
  ChapterAudioMode,
  VoiceRef,
} from "@/lib/bindings";
import { CharacterVoicePicker } from "./character-voice-picker";

export function ChapterAudioSettings({
  projectId,
  chapterId,
  mode,
  device,
  showDevice,
  narrator,
  busy,
  analysisReady,
  narratorOnly = false,
  analysisBusy,
  needsAnalysisModel,
  onMode,
  onDevice,
  onNarrator,
  onAnalyze,
  onRegenerate,
}: {
  projectId: string;
  chapterId: string;
  mode: ChapterAudioMode;
  device: ChapterAudioDeviceChoice | null;
  showDevice: boolean;
  narrator: VoiceRef | null;
  busy: boolean;
  analysisReady: boolean;
  narratorOnly?: boolean;
  analysisBusy: boolean;
  needsAnalysisModel: boolean;
  onMode: (mode: ChapterAudioMode) => void;
  onDevice: (device: ChapterAudioDeviceChoice) => void;
  onNarrator: (voice: VoiceRef) => void;
  onAnalyze: () => void;
  onRegenerate?: () => void;
}) {
  const { t } = useLingui();
  const radioId = useId();
  const models = useModelResources();
  const studio = useVoiceStudio();
  return (
    <div
      className={
        narratorOnly
          ? "min-h-0"
          : "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      }
    >
      {!narratorOnly && (
        <>
          <RadioGroup
            aria-label={t`制作方式`}
            className="grid-cols-2"
            value={mode}
            onValueChange={(value) => {
              if (value === "narrator" || value === "multi_role") onMode(value);
            }}
          >
            <label
              htmlFor={`${radioId}-narrator`}
              className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm"
            >
              <RadioGroupItem
                id={`${radioId}-narrator`}
                value="narrator"
                aria-label={t`单音色旁白`}
              />
              <Trans>单音色旁白</Trans>
            </label>
            <label
              htmlFor={`${radioId}-multi-role`}
              className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm"
            >
              <RadioGroupItem
                id={`${radioId}-multi-role`}
                value="multi_role"
                aria-label={t`多角色`}
              />
              <Trans>多角色</Trans>
            </label>
          </RadioGroup>
          {showDevice && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                <Trans>合成设备</Trans>
              </legend>
              <RadioGroup
                aria-label={t`合成设备`}
                className="grid-cols-2"
                disabled={busy}
                value={device ?? "cpu"}
                onValueChange={(value) => {
                  if (value === "cpu" || value === "metal") onDevice(value);
                }}
              >
                <label
                  htmlFor={`${radioId}-cpu`}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <RadioGroupItem
                    id={`${radioId}-cpu`}
                    value="cpu"
                    aria-label="CPU"
                  />
                  CPU
                </label>
                <label
                  htmlFor={`${radioId}-metal`}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <RadioGroupItem
                    id={`${radioId}-metal`}
                    value="metal"
                    aria-label="Metal"
                  />
                  Metal
                </label>
              </RadioGroup>
            </fieldset>
          )}
          {(mode === "narrator" || !analysisReady || onRegenerate) && (
            <Separator />
          )}
        </>
      )}
      {mode === "narrator" ? (
        <CharacterVoicePicker
          production
          selectImmediately
          defaultOpen={narratorOnly}
          workspaceId={projectId}
          targetKey={`chapter-narrator:${chapterId}`}
          libraryVoices={[]}
          models={models.entries.filter(
            (entry) =>
              entry.capabilities.preset &&
              entry.available_devices.includes("Cpu"),
          )}
          busy={busy}
          studio={studio}
          current={narrator}
          targetLabel={t`旁白`}
          modelsLoading={models.loading}
          modelsError={!!models.error}
          onModelsRetry={() => void models.refresh()}
          onPick={onNarrator}
        />
      ) : !analysisReady ? (
        <Button
          className="self-start"
          disabled={analysisBusy}
          onClick={onAnalyze}
        >
          {needsAnalysisModel ? t`选择模型` : t`分析本章角色`}
        </Button>
      ) : null}
      {!narratorOnly && onRegenerate && (
        <Button
          className="self-start"
          variant="outline"
          disabled={busy}
          onClick={onRegenerate}
        >
          <Trans>生成新版本</Trans>
        </Button>
      )}
    </div>
  );
}
