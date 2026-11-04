import { useWorkspaceState } from "@/lib/desktop-session";
import { sampleVoiceBindings } from "@/lib/sample-voice-bindings";

/** Session-only binding overrides shared by project previews and reverse usage lists. */
export function useSampleVoiceBindings() {
  const [overrides, setOverrides] = useWorkspaceState<Record<string, string>>(
    "sample",
    "voiceBindings",
    {},
  );
  const bindings = sampleVoiceBindings.map((binding) => ({
    ...binding,
    voiceId: overrides[binding.id] ?? binding.voiceId,
  }));
  function changeVoice(bindingId: string, voiceId: string) {
    const initial = sampleVoiceBindings.find(
      (binding) => binding.id === bindingId,
    );
    if (!initial) return;
    setOverrides((current) => {
      const next = { ...current };
      if (voiceId === initial.voiceId) delete next[bindingId];
      else next[bindingId] = voiceId;
      return next;
    });
  }
  return { bindings, changeVoice };
}
