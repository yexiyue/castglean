import assert from "node:assert/strict";
import test from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

globalThis.window = { crypto: globalThis.crypto };

test("browser previews cannot open, save or read real project files", async () => {
  globalThis.isTauri = false;
  const files = await import("../src/lib/project-files.ts?browser");
  const calls = [];
  mockIPC(command => calls.push(command));
  try {
    await assert.rejects(files.openProjectFile(), /desktop_required/);
    await assert.rejects(files.saveProjectFile({ id: "project" }), /desktop_required/);
    await assert.rejects(files.readProjectText({ id: "project" }, "source", 0), /desktop_required/);
    assert.deepEqual(calls, []);
  } finally { clearMocks(); }
});

test("desktop file operations delegate to the Rust host without validating or caching text", async () => {
  globalThis.isTauri = true;
  const files = await import("../src/lib/project-files.ts?desktop");
  const calls = [];
  const project = { id: "project" };
  const text = { sourceId: "source", lines: [] };
  mockIPC((command, args) => {
    calls.push({ command, args });
    return command === "import_text" ? text : project;
  });
  try {
    assert.equal(await files.openProjectFile(), project);
    assert.equal(await files.saveProjectFile(project), project);
    assert.equal(await files.readProjectText(project, "source", 4), text);
    assert.deepEqual(calls, [
      { command: "open_project", args: {} },
      { command: "save_project", args: { id: "project" } },
      { command: "import_text", args: { id: "project", sourceId: "source", line: 4, count: 30 } },
    ]);
  } finally {
    clearMocks();
    delete globalThis.isTauri;
  }
});
