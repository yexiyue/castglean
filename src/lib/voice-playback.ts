import type { VoiceWaveform } from "./bindings";

export interface PlaybackWaveform {
  duration: number;
  peaks: number[][];
}

export interface VoiceAudioSource {
  id: string;
  label: string;
  transcript?: string;
  playback?: {
    media: HTMLAudioElement;
    waveform: PlaybackWaveform;
    onError: () => void;
  };
}

export interface VoicePlaybackSnapshot {
  source: VoiceAudioSource | null;
  error: boolean;
}

interface PlaybackHost {
  voiceAudioLease(
    id: string,
    playing: boolean,
    lease: string,
  ): Promise<unknown>;
  voiceAudioWaveform(id: string): Promise<VoiceWaveform>;
}

interface Lease {
  id: string;
  token: string;
  releasing?: Promise<void>;
}

function validateWaveform(waveform: VoiceWaveform): PlaybackWaveform {
  if (
    waveform.duration === null ||
    !Number.isFinite(waveform.duration) ||
    waveform.duration <= 0 ||
    waveform.peaks.length === 0
  ) {
    throw new Error("Invalid waveform");
  }
  return {
    duration: waveform.duration,
    peaks: waveform.peaks.map((channel) => {
      if (channel.length === 0) throw new Error("Empty waveform channel");
      return channel.map((peak) => {
        if (peak === null || !Number.isFinite(peak))
          throw new Error("Invalid waveform peak");
        return peak;
      });
    }),
  };
}

/** Owns one audible source and ignores results from superseded requests. */
export class VoicePlayback {
  private request = 0;
  private media: HTMLAudioElement | null = null;
  private leases = new Set<Lease>();
  private snapshot: VoicePlaybackSnapshot = { source: null, error: false };
  private host: PlaybackHost;
  private createMedia: (id: string) => HTMLAudioElement;
  private changed: (snapshot: VoicePlaybackSnapshot) => void;

  constructor(
    host: PlaybackHost,
    createMedia: (id: string) => HTMLAudioElement,
    changed: (snapshot: VoicePlaybackSnapshot) => void,
  ) {
    this.host = host;
    this.createMedia = createMedia;
    this.changed = changed;
  }

  private publish(source: VoiceAudioSource | null, error = false): void {
    this.snapshot = { source, error };
    this.changed(this.snapshot);
  }

  private release(lease: Lease): Promise<void> {
    // Keep failed releases so a later stop/play can retry instead of losing ownership.
    lease.releasing ??= this.host
      .voiceAudioLease(lease.id, false, lease.token)
      .then(() => {
        this.leases.delete(lease);
      })
      .finally(() => {
        lease.releasing = undefined;
      });
    return lease.releasing;
  }

  private async clearCurrent(): Promise<void> {
    const media = this.media;
    this.media = null;
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    await Promise.all([...this.leases].map((lease) => this.release(lease)));
  }

  async play(id: string, label: string, transcript?: string): Promise<void> {
    const request = ++this.request;
    this.publish(null);
    const lease = { id, token: crypto.randomUUID() };
    try {
      await this.clearCurrent();
      if (request !== this.request) return;
      await this.host.voiceAudioLease(id, true, lease.token);
      this.leases.add(lease);
      if (request !== this.request) {
        await this.release(lease);
        return;
      }
      this.publish({ id, label, transcript });
      const result = await this.host.voiceAudioWaveform(id);
      if (request !== this.request) return;
      const waveform = validateWaveform(result);
      const media = this.createMedia(id);
      this.media = media;
      this.publish({
        id,
        label,
        transcript,
        playback: {
          media,
          waveform,
          onError: () => {
            if (request === this.request)
              this.publish(this.snapshot.source, true);
          },
        },
      });
    } catch {
      if (request !== this.request) return;
      await this.clearCurrent().catch(() => {});
      if (request === this.request) this.publish(null, true);
    }
  }

  async stop(): Promise<void> {
    const request = ++this.request;
    this.publish(null);
    try {
      await this.clearCurrent();
    } catch {
      if (request === this.request) this.publish(null, true);
    }
  }

  /** Invalidate in-flight work before unmount; no later UI updates are emitted. */
  dispose(): Promise<void> {
    this.request++;
    return this.clearCurrent();
  }
}
