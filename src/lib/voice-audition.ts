import type { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type {
  BindingTarget,
  Character,
  ModelEntry,
  VoiceRef,
} from "@/lib/bindings";
import { commands } from "@/lib/bindings";

/** Shared audition text for preset voices across the character center. */
export const AUDITION_TEXT =
  "你好，欢迎收听今天的故事。山风吹过松林，星光照亮归途。";

export function characterDisplayLabel(
  characters: Character[],
  id: string,
  fallback: string,
): string {
  const character = characters.find((item) => item.id === id);
  if (!character) return `${fallback} (${id})`;
  return characters.some(
    (item) => item.id !== id && item.displayName === character.displayName,
  )
    ? `${character.displayName} (${id})`
    : character.displayName;
}

export function voiceLabel(voice: VoiceRef): string {
  return voice.kind === "library"
    ? voice.id
    : `${voice.backend} / ${voice.model} / ${voice.voice}`;
}

export function sameTarget(a: BindingTarget, b: BindingTarget): boolean {
  return a.kind === "narrator"
    ? b.kind === "narrator"
    : b.kind === "character" && a.character_id === b.character_id;
}

export function sameVoice(a: VoiceRef, b: VoiceRef): boolean {
  return a.kind === "library"
    ? b.kind === "library" && a.id === b.id
    : b.kind === "preset" &&
        a.backend === b.backend &&
        a.model === b.model &&
        a.voice === b.voice;
}

function modelEntry(models: ModelEntry[], voice: VoiceRef) {
  if (voice.kind !== "preset") return undefined;
  return models.find(
    (model) => model.backend === voice.backend && model.model === voice.model,
  );
}

/** A preset voice can audition only when its model is ready with a device. */
export function presetPlayable(models: ModelEntry[], voice: VoiceRef): boolean {
  if (voice.kind === "library") return true;
  const entry = modelEntry(models, voice);
  return (
    entry?.resource === "Ready" && (entry.available_devices.length ?? 0) > 0
  );
}

/**
 * Play one voice reference through the shared player: library voices stream
 * their reference audio, preset voices start a real audition synthesis job.
 */
export function playVoiceRef({
  voice,
  studio,
  player,
  models,
  text,
}: {
  voice: VoiceRef;
  studio: VoiceStudio;
  player: ReturnType<typeof useVoicePlayer>;
  models: ModelEntry[];
  text?: string;
}): void {
  if (voice.kind === "library") {
    void studio.run(async () => {
      const audio = await commands.voiceReferenceAudio(voice.id);
      await player.play(audio, voice.id);
    });
    return;
  }
  const entry = modelEntry(models, voice);
  const device = entry?.available_devices[0];
  if (entry?.resource !== "Ready" || !device) return;
  void studio.start({
    kind: "audition",
    backend: voice.backend,
    model: voice.model,
    device,
    voice: { kind: "preset", voice: voice.voice },
    text: text ?? AUDITION_TEXT,
    style: null,
  });
}
