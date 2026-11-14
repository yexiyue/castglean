import { useState } from "react";
import { useStudioOperations } from "@/hooks/use-studio-operations";

export function useCandidateMutation(
  id: string,
  name: string,
  stop: () => Promise<void>,
) {
  const operations = useStudioOperations();
  const [stopFailed, setStopFailed] = useState(false);
  const operation = operations.candidates.get(id);
  const auditionPending = operations.hasCandidateAudition(id);
  const save = () => {
    setStopFailed(false);
    void operations.startCandidate(id, name, "save");
  };
  const remove = async () => {
    setStopFailed(false);
    try {
      await stop();
      await operations.startCandidate(id, name, "remove");
    } catch {
      setStopFailed(true);
    }
  };
  return { operation, auditionPending, stopFailed, save, remove };
}
