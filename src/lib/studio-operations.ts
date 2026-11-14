import type {
  BindingTarget,
  LibraryVoice,
  StudioJob,
  StudioRequest_Deserialize,
  StudioSnapshot_Serialize,
  VoiceSelection,
} from "./bindings";
export type DesignOrigin = { projectId: string; target: BindingTarget };

export function auditionIdentity(voice: VoiceSelection, fixedModel?: string) {
  return JSON.stringify([voice, fixedModel ?? null]);
}

export function clearAuditionDraft(
  values: Record<string, unknown>,
  registry: StudioOperationRegistry,
  identity: string,
) {
  delete values[`audition:${identity}`];
  delete values[`auditionBaseline:${identity}`];
  registry.setDraftDirty(identity, false);
}

type Host = {
  startVoiceJob: (
    key: string,
    request: StudioRequest_Deserialize,
  ) => Promise<number>;
  voiceStudioSnapshot: () => Promise<StudioSnapshot_Serialize>;
  selectVoiceReference: (
    key: string,
    name: string,
    transcript: string,
  ) => Promise<string | null>;
  saveVoiceCandidate: (id: string) => Promise<LibraryVoice>;
  discardVoiceCandidate: (id: string) => Promise<unknown>;
};
export type CandidateMutation = {
  id: string;
  name: string;
  action: "save" | "remove";
  phase: "write" | "read";
  busy: boolean;
  failed: boolean;
  checked: boolean;
  current: "missing" | "saved" | "unsaved" | null;
};
type ReferenceOperation = {
  key: string;
  name: string;
  transcript: string;
  phase: "select" | "read";
  busy: boolean;
  failed: boolean;
  missing: boolean;
  candidateId: string | null;
};
export type StudioOperation = {
  identity: string;
  key: string;
  request: StudioRequest_Deserialize;
  phase: "start" | "read";
  busy: boolean;
  failed: boolean;
  startError: "retired" | "limit" | "unknown" | null;
  abandonFailed: boolean;
  missing: boolean;
  jobId: number | null;
  origin: DesignOrigin | null;
};

export function canRetryStudioOperation(operation: StudioOperation): boolean {
  return (
    !operation.busy &&
    operation.startError !== "retired" &&
    operation.startError !== "limit"
  );
}

export function canAbandonStudioOperation(operation: StudioOperation): boolean {
  return !operation.busy && (operation.phase === "start" || operation.missing);
}

/** Pending submissions survive route unmounts; the host owns jobs and audio. */
export class StudioOperationRegistry {
  readonly entries = new Map<string, StudioOperation>();
  readonly candidates = new Map<string, CandidateMutation>();
  private jobOrigins = new Map<number, DesignOrigin>();
  private candidateOrigins = new Map<string, DesignOrigin>();
  reference: ReferenceOperation | null = null;
  private dirtyDrafts = new Set<string>();
  completion = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private guardingUnload = false;
  private host: Host;
  private makeId: () => string;
  private onCandidateAbsent: (id: string) => void;
  private beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  constructor(
    host: Host,
    makeId = () => crypto.randomUUID(),
    onCandidateAbsent: (id: string) => void = () => {},
  ) {
    this.host = host;
    this.makeId = makeId;
    this.onCandidateAbsent = onCandidateAbsent;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  hasPending = () =>
    this.entries.size > 0 ||
    this.candidates.size > 0 ||
    !!this.reference ||
    this.dirtyDrafts.size > 0;
  setDraftDirty(identity: string, dirty: boolean) {
    if (this.dirtyDrafts.has(identity) === dirty) return;
    if (dirty) this.dirtyDrafts.add(identity);
    else this.dirtyDrafts.delete(identity);
    this.notify();
  }
  private notify() {
    if (
      typeof window !== "undefined" &&
      this.hasPending() !== this.guardingUnload
    ) {
      this.guardingUnload = this.hasPending();
      if (this.guardingUnload)
        window.addEventListener("beforeunload", this.beforeUnload);
      else window.removeEventListener("beforeunload", this.beforeUnload);
    }
    this.version++;
    for (const listener of this.listeners) listener();
  }
  originForJob = (id: number) => this.jobOrigins.get(id) ?? null;
  originForCandidate = (id: string) => this.candidateOrigins.get(id) ?? null;
  hasCandidateAudition = (id: string) =>
    Array.from(this.entries.values()).some(
      (op) =>
        op.request.kind === "audition" &&
        op.request.voice.kind === "candidate" &&
        op.request.voice.id === id,
    );
  rememberJobs(jobs: StudioJob[]) {
    for (const job of jobs) {
      const origin = this.jobOrigins.get(job.id);
      if (origin && job.candidate)
        this.candidateOrigins.set(job.candidate, origin);
    }
  }
  async start(
    identity: string,
    request: StudioRequest_Deserialize,
    origin: DesignOrigin | null = null,
  ) {
    if (
      this.entries.has(identity) ||
      (request.kind === "audition" &&
        request.voice.kind === "candidate" &&
        this.candidates.has(request.voice.id))
    )
      return false;
    this.entries.set(identity, {
      identity,
      key: this.makeId(),
      request: structuredClone(request),
      phase: "start",
      busy: false,
      failed: false,
      startError: null,
      abandonFailed: false,
      missing: false,
      jobId: null,
      origin: origin ? structuredClone(origin) : null,
    });
    this.notify();
    await this.resume(identity);
    return true;
  }
  async startReference(name: string, transcript: string) {
    if (this.reference) return;
    this.reference = {
      key: this.makeId(),
      name,
      transcript,
      phase: "select",
      busy: false,
      failed: false,
      missing: false,
      candidateId: null,
    };
    this.notify();
    await this.resumeReference();
  }
  async startCandidate(id: string, name: string, action: "save" | "remove") {
    if (this.candidates.has(id) || this.hasCandidateAudition(id)) return false;
    this.candidates.set(id, {
      id,
      name,
      action,
      phase: "write",
      busy: false,
      failed: false,
      checked: false,
      current: null,
    });
    this.notify();
    await this.resumeCandidate(id);
    return true;
  }
  async resumeCandidate(id: string) {
    const op = this.candidates.get(id);
    if (
      !op ||
      op.busy ||
      (op.failed &&
        op.phase === "write" &&
        (!op.checked || op.current === "missing"))
    )
      return;
    op.busy = true;
    op.failed = false;
    op.checked = false;
    this.notify();
    try {
      if (op.phase === "write") {
        if (op.action === "save") await this.host.saveVoiceCandidate(id);
        else await this.host.discardVoiceCandidate(id);
        op.phase = "read";
        this.notify();
      }
      const snapshot = await this.host.voiceStudioSnapshot();
      const candidate = snapshot.candidates.find((entry) => entry.id === id);
      if (op.action === "save" ? !candidate?.saved_id : !!candidate) {
        op.current = !candidate
          ? "missing"
          : candidate.saved_id
            ? "saved"
            : "unsaved";
        op.checked = true;
        op.failed = true;
        return;
      }
      this.candidates.delete(id);
      if (op.action === "remove") this.onCandidateAbsent(id);
      this.completion++;
    } catch {
      op.failed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  async checkCandidate(id: string) {
    const op = this.candidates.get(id);
    if (!op || op.busy) return;
    op.busy = true;
    op.checked = false;
    this.notify();
    try {
      const snapshot = await this.host.voiceStudioSnapshot();
      const candidate = snapshot.candidates.find((entry) => entry.id === id);
      op.current = !candidate
        ? "missing"
        : candidate.saved_id
          ? "saved"
          : "unsaved";
      op.checked = true;
    } catch {
      op.failed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  stopCandidateRecovery(id: string) {
    const op = this.candidates.get(id);
    if (!op || op.busy || !op.checked) return;
    this.candidates.delete(id);
    if (op.current === "missing") this.onCandidateAbsent(id);
    this.completion++;
    this.notify();
  }
  async resumeReference() {
    const op = this.reference;
    if (!op || op.busy) return;
    op.busy = true;
    op.failed = false;
    op.missing = false;
    this.notify();
    try {
      if (op.phase === "select") {
        const candidate = await this.host.selectVoiceReference(
          op.key,
          op.name,
          op.transcript,
        );
        if (!candidate) {
          this.reference = null;
          this.completion++;
          return;
        }
        op.candidateId = candidate;
        op.phase = "read";
      }
      const snapshot = await this.host.voiceStudioSnapshot();
      if (
        !snapshot.candidates.some(
          (candidate) => candidate.id === op.candidateId,
        )
      ) {
        op.missing = true;
        op.failed = true;
        return;
      }
      this.reference = null;
      this.completion++;
    } catch {
      op.failed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  async abandonReference() {
    const op = this.reference;
    if (!op || op.busy) return;
    op.busy = true;
    op.failed = false;
    this.notify();
    try {
      await this.host.voiceStudioSnapshot();
      this.reference = null;
      this.completion++;
    } catch {
      op.failed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  async resume(identity: string) {
    const op = this.entries.get(identity);
    if (
      !op ||
      op.busy ||
      op.startError === "retired" ||
      op.startError === "limit"
    )
      return;
    op.busy = true;
    op.failed = false;
    op.startError = null;
    op.abandonFailed = false;
    op.missing = false;
    this.notify();
    try {
      if (op.phase === "start") {
        op.jobId = await this.host.startVoiceJob(op.key, op.request);
        if (op.origin) this.jobOrigins.set(op.jobId, op.origin);
        op.phase = "read";
        this.notify();
      }
      const snapshot = await this.host.voiceStudioSnapshot();
      this.rememberJobs(snapshot.jobs);
      if (
        op.jobId !== null &&
        !snapshot.jobs.some((job) => job.id === op.jobId)
      ) {
        op.missing = true;
        op.failed = true;
        return;
      }
      op.missing = false;
      this.entries.delete(identity);
      this.completion++;
    } catch (cause) {
      op.failed = true;
      if (op.phase === "start") {
        op.startError =
          cause === "request already dismissed"
            ? "retired"
            : cause ===
                "session task identity limit reached; restart the application"
              ? "limit"
              : "unknown";
      }
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  async abandon(identity: string) {
    const op = this.entries.get(identity);
    if (!op || op.busy) return;
    op.busy = true;
    op.abandonFailed = false;
    this.notify();
    try {
      await this.host.voiceStudioSnapshot();
      this.entries.delete(identity);
      this.completion++;
    } catch {
      op.abandonFailed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
}
