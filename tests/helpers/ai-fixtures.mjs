export const budget = { requests: 1, inputBytes: 10, toolCalls: 0, toolBytes: 0 };
export const configuration = { selection: { connectionId: "c", modelId: "m" }, revision: 1 };
export const message = (text = "🙂") => ({ id: "answer", role: "assistant", content: text });
export const page = (sequence = 0, status = "running", messages = [message()]) => ({
  session: { id: "session", projectId: "project", taskKind: "chapter_splitting", chapterId: null, title: "分章", configuration, budget, sequence },
  run: { id: "run", sessionId: "session", retryOf: null, status, configuration, baseRevision: 1, budget, error: null, workspaceContext: null },
  messages, records: messages.map((value) => ({ id: value.id, runId: "run", subagentRunId: null, status: status === "running" ? "streaming" : "complete", usage: null, results: [], tools: {} })),
  runs: [], contexts: {}, before: null, invocations: [], interrupts: [],
});
export function frame(snapshot, restore = true) {
  const events = [];
  if (restore && snapshot.run) events.push({ type: "RUN_STARTED", threadId: "session", runId: snapshot.run.id });
  events.push({ type: "MESSAGES_SNAPSHOT", messages: snapshot.messages });
  events.push({ type: "STATE_SNAPSHOT", snapshot: { tasks: snapshot.invocations } });
  if (snapshot.run && !["queued", "running", "cancelling"].includes(snapshot.run.status))
    events.push({ type: "RUN_FINISHED", threadId: "session", runId: snapshot.run.id, outcome: { type: snapshot.run.status === "cancelled" ? "cancelled" : "success" } });
  return { type: "events", cursor: snapshot.session.sequence, restore, page: snapshot, events };
}
