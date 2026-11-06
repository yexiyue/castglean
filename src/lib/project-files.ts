import { isTauri } from "@tauri-apps/api/core";
import type { ImportSnapshot, TextPage } from "./bindings.ts";
import { commands } from "./bindings.ts";

export const desktop = isTauri();
export type FileState = { filename: string };

function requireDesktop(): void {
  if (!desktop) throw new Error("desktop_required");
}

export async function openProjectFile(): Promise<ImportSnapshot | null> {
  requireDesktop();
  return commands.openProject();
}

export async function saveProjectFile(
  project: ImportSnapshot,
): Promise<ImportSnapshot | null> {
  requireDesktop();
  return commands.saveProject(project.id);
}

export async function readProjectText(
  project: ImportSnapshot,
  sourceId: string,
  line: number,
  count = 30,
): Promise<TextPage> {
  requireDesktop();
  return commands.importText(project.id, sourceId, line, count);
}
