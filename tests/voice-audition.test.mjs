import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("voice identity ignores property order and compares every resolving field", async () => {
  const server = await createServer({
    configFile: false,
    logLevel: "error",
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { sameVoice } = await server.ssrLoadModule("/src/lib/voice-audition.ts");
    const library = { kind: "library", id: "voice-a" };
    const preset = { kind: "preset", backend: "cpu", model: "kokoro", voice: "one" };
    assert.ok(sameVoice(library, { id: "voice-a", kind: "library" }));
    assert.ok(sameVoice(preset, { voice: "one", model: "kokoro", backend: "cpu", kind: "preset" }));
    assert.equal(sameVoice(library, { ...library, id: "voice-b" }), false);
    assert.equal(sameVoice(library, preset), false);
    assert.equal(sameVoice(preset, library), false);
    for (const field of ["backend", "model", "voice"]) {
      assert.equal(sameVoice(preset, { ...preset, [field]: "other" }), false);
    }
  } finally {
    await server.close();
  }
});
