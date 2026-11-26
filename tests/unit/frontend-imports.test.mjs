import { expect, test } from "vitest";
import { frontendImportViolations } from "../../scripts/check-frontend-imports.mjs";

test.each([
  ["lib/voice.ts", 'import type { T } from "@/components/voices/voice-player"'],
  ["components/assistant-ui/thread.tsx", 'const task = import(`../projects/chapter-inspector`)'],
  ["hooks/player.ts", 'type T = import("../components/projects/chapter-inspector").Props'],
  ["lib/voice.ts", 'export { fn } from "../hooks/use-voice-studio"'],
  ["components/assistant-ui/thread.tsx", 'const task = import("../projects/chapter-inspector")'],
  ["components/assistant-ui/thread.tsx", 'const task = require("@/components/projects/chapter-inspector")'],
  ["routes/index.tsx", 'import { DesktopAgent } from "@/lib/ai/agent"'],
  ["routes/index.tsx", 'const agent = import("@/lib/ai/./agent.ts?raw")'],
  ["lib/voice.ts", 'import component from "@/lib/../components/voices/voice-player"'],
])("rejects an import across an ownership boundary from %s", (file, source) => {
  expect(frontendImportViolations(file, source)).toHaveLength(1);
});

test.each([
  ["components/assistant-ui/thread.tsx", 'import { Recovery } from "../chapter-structure/recovery"'],
  ["hooks/use-ai-session.ts", 'import { DesktopAgent } from "@/lib/ai"'],
  ["lib/ai/agent.ts", 'import type { AgentStart } from "./pending-starts"'],
])("allows a public entry or an import within its owner from %s", (file, source) => {
  expect(frontendImportViolations(file, source)).toEqual([]);
});
