export const budget = { requests: 1, inputBytes: 10, toolCalls: 0, toolBytes: 0 };
export const configuration = { selection: { connectionId: "c", modelId: "m" }, revision: 1 };
export const message = (text = "🙂", version = 1) => ({ id: "answer", runId: "run", ordinal: 1, role: "assistant", version, status: "streaming", parts: { version: 1, parts: [{ type: "text", text }] } });
export const page = (sequence = 0, status = "running", messages = [message()]) => ({
  session: { id: "session", projectId: "project", taskKind: "chapter_splitting", chapterId: null, title: "分章", configuration, budget, sequence },
  run: { id: "run", sessionId: "session", retryOf: null, status, configuration, baseRevision: 1, budget, error: null },
  messages, before: null,
});
export const update = (snapshot, changes = []) => ({ type: "update", version: 1, sessionId: "session", runId: "run", sequence: snapshot.session.sequence, session: snapshot.session, run: snapshot.run, changes });
