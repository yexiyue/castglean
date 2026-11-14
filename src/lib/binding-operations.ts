import type {
  BindingStateView_Serialize,
  BindingTarget,
  CharacterEdit,
  LocalProjectSnapshot_Serialize,
  ManualBindingEdit,
  ProfileView_Serialize,
} from "./bindings";

export type BindingHost = {
  localProjectSnapshot: (
    projectId: string,
  ) => Promise<LocalProjectSnapshot_Serialize>;
  voiceBindingBindings: (
    projectId: string,
  ) => Promise<BindingStateView_Serialize[]>;
  voiceBindingEdit: (
    projectId: string,
    target: BindingTarget,
    commandId: string,
    projectRevision: number,
    bindingRevision: number,
    edit: ManualBindingEdit,
  ) => Promise<unknown>;
  voiceBindingProfiles: (projectId: string) => Promise<ProfileView_Serialize[]>;
  voiceBindingProfileSet: (
    projectId: string,
    target: BindingTarget,
    commandId: string,
    projectRevision: number,
    profileRevision: number,
    text: string,
  ) => Promise<unknown>;
  chapterAnalysisCharacterUsage: (
    projectId: string,
    characterId: string,
  ) => Promise<{ chapterId: string }[]>;
  chapterAnalysisCharacterAliases: (
    projectId: string,
    characterId: string,
  ) => Promise<unknown>;
  chapterAnalysisCharacters: (projectId: string) => Promise<unknown>;
  chapterAnalysisSnapshot: (
    projectId: string,
    chapterId: string,
  ) => Promise<unknown>;
  chapterAnalysisCharacterEdit: (
    projectId: string,
    characterId: string,
    commandId: string,
    expectedRevision: number,
    edit: CharacterEdit,
  ) => Promise<unknown>;
};
export type IdentityOperation = {
  characterId: string;
  chapterId: string;
  revision: number;
  commandId: string;
  edit: CharacterEdit;
  phase: "prepare" | "write" | "read";
  busy: boolean;
  error: "prepare" | "unknown" | "rejected" | "read" | null;
  abandonFailed: boolean;
};
export type ProfileOperation = {
  target: BindingTarget;
  text: string;
  commandId: string;
  projectRevision: number;
  profileRevision: number;
  phase: "write" | "read";
  busy: boolean;
  error: "unknown" | "rejected" | "read" | null;
  abandonFailed: boolean;
};
export type BindingOperation = {
  target: BindingTarget;
  edit: ManualBindingEdit;
  commandId: string;
  projectRevision: number | null;
  bindingRevision: number | null;
  phase: "prepare" | "write" | "read";
  busy: boolean;
  error: "prepare" | "unknown" | "rejected" | "read" | null;
  abandonFailed: boolean;
};
export type BindingSnapshot = {
  project: LocalProjectSnapshot_Serialize;
  bindings: BindingStateView_Serialize[];
};
function sameTarget(a: BindingTarget, b: BindingTarget) {
  return a.kind === "narrator"
    ? b.kind === "narrator"
    : b.kind === "character" && a.character_id === b.character_id;
}
const rejected = new Set([
  "conflict",
  "invalid_target",
  "invalid_voice_ref",
  "invalid_data",
  "not_found",
  "source_changed",
  "capacity_exceeded",
]);

/** One revisioned binding write per project, retained across views until its result is read. */
export class BindingOperationRegistry {
  operation: BindingOperation | null = null;
  profileOperation: ProfileOperation | null = null;
  identityOperation: IdentityOperation | null = null;
  identityCompletion = 0;
  latestProfiles: ProfileView_Serialize[] | null = null;
  latest: BindingSnapshot | null = null;
  completion = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private guardingUnload = false;
  private dirtyDrafts = new Set<string>();
  private beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  private projectId: string;
  private host: BindingHost;
  private makeId: () => string;
  constructor(
    projectId: string,
    host: BindingHost,
    makeId = () => crypto.randomUUID(),
  ) {
    this.projectId = projectId;
    this.host = host;
    this.makeId = makeId;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  hasPending = () =>
    !!this.operation ||
    !!this.profileOperation ||
    !!this.identityOperation ||
    this.dirtyDrafts.size > 0;
  setDraftDirty(key: string, dirty: boolean) {
    if (this.dirtyDrafts.has(key) === dirty) return;
    if (dirty) this.dirtyDrafts.add(key);
    else this.dirtyDrafts.delete(key);
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
  async start(target: BindingTarget, edit: ManualBindingEdit) {
    if (this.operation || this.profileOperation || this.identityOperation)
      return false;
    this.operation = {
      target: structuredClone(target),
      edit: structuredClone(edit),
      commandId: this.makeId(),
      projectRevision: null,
      bindingRevision: null,
      phase: "prepare",
      busy: false,
      error: null,
      abandonFailed: false,
    };
    this.notify();
    await this.resume();
    return true;
  }
  async startProfile(
    target: BindingTarget,
    text: string,
    projectRevision: number,
    profileRevision: number,
  ) {
    if (this.operation || this.profileOperation || this.identityOperation)
      return false;
    this.profileOperation = {
      target: structuredClone(target),
      text,
      commandId: this.makeId(),
      projectRevision,
      profileRevision,
      phase: "write",
      busy: false,
      error: null,
      abandonFailed: false,
    };
    this.notify();
    await this.resumeProfile();
    return true;
  }
  async resumeProfile() {
    const op = this.profileOperation;
    if (!op || op.busy || op.error === "rejected") return;
    op.busy = true;
    op.error = null;
    op.abandonFailed = false;
    this.notify();
    try {
      if (op.phase === "write") {
        await this.host.voiceBindingProfileSet(
          this.projectId,
          op.target,
          op.commandId,
          op.projectRevision,
          op.profileRevision,
          op.text,
        );
        op.phase = "read";
        this.notify();
      }
      await this.readProfileState();
      this.profileOperation = null;
      this.completion++;
    } catch (cause) {
      op.error =
        op.phase === "read"
          ? "read"
          : typeof cause === "string" && rejected.has(cause)
            ? "rejected"
            : "unknown";
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  async abandonProfile() {
    const op = this.profileOperation;
    if (!op || op.busy) return;
    op.busy = true;
    op.abandonFailed = false;
    this.notify();
    try {
      await this.readProfileState();
      this.profileOperation = null;
      this.completion++;
    } catch {
      op.abandonFailed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  private async readProfileState() {
    const [snapshot, profiles] = await Promise.all([
      this.read(),
      this.host.voiceBindingProfiles(this.projectId),
    ]);
    this.latest = snapshot;
    this.latestProfiles = profiles;
  }
  async startIdentity(
    characterId: string,
    chapterId: string,
    revision: number,
    edit: CharacterEdit,
  ) {
    if (this.operation || this.profileOperation || this.identityOperation)
      return false;
    this.identityOperation = {
      characterId,
      chapterId,
      revision,
      commandId: this.makeId(),
      edit: structuredClone(edit),
      phase: edit.type === "rename" ? "prepare" : "write",
      busy: false,
      error: null,
      abandonFailed: false,
    };
    this.notify();
    await this.resumeIdentity();
    return true;
  }
  async resumeIdentity() {
    const op = this.identityOperation;
    if (!op || op.busy || op.error === "rejected") return;
    op.busy = true;
    op.error = null;
    op.abandonFailed = false;
    this.notify();
    try {
      if (op.phase === "prepare") {
        const usage = await this.host.chapterAnalysisCharacterUsage(
          this.projectId,
          op.characterId,
        );
        if (op.edit.type !== "rename")
          throw new Error("invalid identity preparation");
        op.edit.expected_affected_chapters = usage.map(
          (item) => item.chapterId,
        );
        op.phase = "write";
        this.notify();
      }
      if (op.phase === "write") {
        await this.host.chapterAnalysisCharacterEdit(
          this.projectId,
          op.characterId,
          op.commandId,
          op.revision,
          op.edit,
        );
        op.phase = "read";
        this.notify();
      }
      await this.readIdentity(op);
      this.identityOperation = null;
      this.identityCompletion++;
    } catch (cause) {
      op.error =
        op.phase === "prepare"
          ? "prepare"
          : op.phase === "read"
            ? "read"
            : typeof cause === "string" && rejected.has(cause)
              ? "rejected"
              : "unknown";
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  async abandonIdentity() {
    const op = this.identityOperation;
    if (!op || op.busy) return;
    op.busy = true;
    op.abandonFailed = false;
    this.notify();
    try {
      await this.readIdentity(op);
      this.identityOperation = null;
      this.identityCompletion++;
    } catch {
      op.abandonFailed = true;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  private async readIdentity(op: IdentityOperation) {
    await Promise.all([
      this.host.chapterAnalysisCharacters(this.projectId),
      this.host.chapterAnalysisSnapshot(this.projectId, op.chapterId),
      this.host.chapterAnalysisCharacterUsage(this.projectId, op.characterId),
      this.host.chapterAnalysisCharacterAliases(this.projectId, op.characterId),
    ]);
  }
  async resume() {
    const op = this.operation;
    if (!op || op.busy || op.error === "rejected") return;
    op.busy = true;
    op.error = null;
    op.abandonFailed = false;
    this.notify();
    try {
      if (op.phase === "prepare") {
        const { project, bindings } = await this.read();
        op.projectRevision = project.revision;
        op.bindingRevision =
          bindings.find((binding) => sameTarget(binding.target, op.target))
            ?.revision ?? 0;
        op.phase = "write";
        this.notify();
      }
      if (op.phase === "write") {
        if (op.projectRevision === null || op.bindingRevision === null)
          throw new Error("binding operation has no frozen revisions");
        await this.host.voiceBindingEdit(
          this.projectId,
          op.target,
          op.commandId,
          op.projectRevision,
          op.bindingRevision,
          op.edit,
        );
        op.phase = "read";
        this.notify();
      }
      const result = await this.read();
      this.latest = result;
      this.completion++;
      this.operation = null;
    } catch (cause) {
      op.error =
        op.phase === "prepare"
          ? "prepare"
          : op.phase === "read"
            ? "read"
            : typeof cause === "string" && rejected.has(cause)
              ? "rejected"
              : "unknown";
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  /** Explicitly abandon a failed operation only after refreshing its authoritative state. */
  async abandon() {
    const op = this.operation;
    if (!op || op.busy) return;
    op.busy = true;
    op.abandonFailed = false;
    this.notify();
    try {
      this.latest = await this.read();
      this.completion++;
      this.operation = null;
    } catch {
      op.abandonFailed = true;
      op.error = op.phase === "read" ? "read" : op.error;
    } finally {
      op.busy = false;
      this.notify();
    }
  }
  private async read(): Promise<BindingSnapshot> {
    const [project, bindings] = await Promise.all([
      this.host.localProjectSnapshot(this.projectId),
      this.host.voiceBindingBindings(this.projectId),
    ]);
    return { project, bindings };
  }
}
