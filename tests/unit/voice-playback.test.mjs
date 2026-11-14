import assert from "node:assert/strict";
import { test } from "vitest";
import { VoicePlayback } from "../../src/lib/voice-playback.ts";

const waveform = { duration: 2, peaks: [[0, 0.5, 1, 0]] };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(overrides = {}) {
  const events = [];
  const snapshots = [];
  const host = {
    async voiceAudioLease(id, playing, lease) {
      events.push({ kind: playing ? "acquire" : "release", id, lease });
    },
    async voiceAudioWaveform() { return waveform; },
    ...overrides,
  };
  const playback = new VoicePlayback(host, (id) => {
    events.push({ kind: "create", id });
    return {
      pause() { events.push({ kind: "pause", id }); },
      removeAttribute(name) { events.push({ kind: "remove", id, name }); },
      load() { events.push({ kind: "load", id }); },
    };
  }, (snapshot) => snapshots.push(snapshot));
  return { playback, events, snapshots, latest: () => snapshots.at(-1) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("stop detaches media before releasing its exact lease", async () => {
  const f = fixture();
  await f.playback.play("one", "Voice one");
  const source = f.latest().source;
  assert.equal(source.label, "Voice one");
  assert.deepEqual(source.playback.waveform, waveform);
  await f.playback.stop();
  assert.deepEqual(f.events.map((event) => event.kind), [
    "acquire", "create", "pause", "remove", "load", "release",
  ]);
  assert.equal(f.events[0].lease, f.events.at(-1).lease);
  assert.deepEqual(f.latest(), { source: null, error: false });
});

test("a superseded waveform cannot create media or replace the latest source", async () => {
  const first = deferred();
  const f = fixture({ voiceAudioWaveform: (id) => id === "one" ? first.promise : Promise.resolve(waveform) });
  const old = f.playback.play("one", "One");
  await flush();
  await f.playback.play("two", "Two");
  first.resolve(waveform);
  await old;
  assert.equal(f.latest().source.id, "two");
  assert.deepEqual(f.events.filter((event) => event.kind === "create").map((event) => event.id), ["two"]);
  assert.ok(f.events.some((event) => event.kind === "release" && event.id === "one"));
});

test("stop during lease acquisition releases the late lease without reopening UI", async () => {
  const acquired = deferred();
  const calls = [];
  const f = fixture({
    voiceAudioLease(id, playing, lease) {
      calls.push({ id, playing, lease });
      return playing ? acquired.promise : Promise.resolve();
    },
  });
  const old = f.playback.play("one", "One");
  await flush();
  await f.playback.stop();
  const stopped = f.snapshots.length;
  acquired.resolve();
  await old;
  assert.equal(f.snapshots.length, stopped);
  assert.deepEqual(calls.map((call) => call.playing), [true, false]);
  assert.equal(calls[0].lease, calls[1].lease);
  assert.equal(f.events.length, 0);
});

test("late media errors cannot reopen stopped UI or mark a replacement as failed", async () => {
  const f = fixture();
  await f.playback.play("one", "One");
  const reportOldError = f.latest().source.playback.onError;
  await f.playback.stop();
  reportOldError();
  assert.deepEqual(f.latest(), { source: null, error: false });
  await f.playback.play("two", "Two");
  reportOldError();
  assert.equal(f.latest().source.id, "two");
  assert.equal(f.latest().error, false);
  f.latest().source.playback.onError();
  assert.equal(f.latest().error, true);
});

test("old failure cleanup cannot publish an error after a new request starts", async () => {
  const release = deferred();
  const f = fixture({
    voiceAudioWaveform: (id) => id === "one" ? Promise.reject(new Error("bad WAV")) : Promise.resolve(waveform),
    voiceAudioLease: (id, playing) => !playing && id === "one" ? release.promise : Promise.resolve(),
  });
  const old = f.playback.play("one", "One");
  await flush();
  const next = f.playback.play("two", "Two");
  release.resolve();
  await Promise.all([old, next]);
  assert.equal(f.latest().source.id, "two");
  assert.equal(f.latest().error, false);
  assert.equal(f.snapshots.some((snapshot) => snapshot.error), false);
});

test("failed lease release remains owned and can be retried by stop", async () => {
  let attempts = 0;
  const f = fixture({
    async voiceAudioLease(_id, playing) {
      if (!playing && ++attempts === 1) throw new Error("IPC failed");
    },
  });
  await f.playback.play("one", "One");
  await f.playback.stop();
  assert.equal(f.latest().error, true);
  await f.playback.stop();
  assert.equal(attempts, 2);
  assert.deepEqual(f.latest(), { source: null, error: false });
});

test("dispose invalidates waveform and playback error callbacks without UI updates", async () => {
  const result = deferred();
  const f = fixture({ voiceAudioWaveform: () => result.promise });
  const pending = f.playback.play("one", "One");
  await flush();
  await f.playback.dispose();
  const count = f.snapshots.length;
  result.resolve(waveform);
  await pending;
  assert.equal(f.snapshots.length, count);
  assert.equal(f.events.some((event) => event.kind === "create"), false);
});

test("invalid nullable waveform is rejected before a media element is created", async () => {
  for (const invalid of [
    { duration: null, peaks: [[0]] },
    { duration: -1, peaks: [[0]] },
    { duration: 1, peaks: [] },
    { duration: 1, peaks: [[]] },
    { duration: 1, peaks: [[null]] },
  ]) {
    const f = fixture({ voiceAudioWaveform: async () => invalid });
    await f.playback.play("one", "One");
    assert.deepEqual(f.latest(), { source: null, error: true });
    assert.deepEqual(f.events.map((event) => event.kind), ["acquire", "release"]);
  }
});


test("dispose also invalidates error callbacks from an already-ready source", async () => {
  const f = fixture();
  await f.playback.play("one", "One");
  const reportError = f.latest().source.playback.onError;
  const count = f.snapshots.length;
  await f.playback.dispose();
  reportError();
  assert.equal(f.snapshots.length, count);
  assert.deepEqual(f.events.slice(-4).map((event) => event.kind), ["pause", "remove", "load", "release"]);
});
