import { isTauri } from "@tauri-apps/api/core";
import { commands } from "@/lib/bindings";
import type {
  ProjectDocument,
  ProjectInput,
  ProjectError,
} from "@/lib/bindings";
import type { PreviewProject } from "@/lib/preview-projects";

export const desktop = isTauri();
const encoder = new TextEncoder();
const MAX_SOURCE = 5 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_DOCUMENT = 128 * 1024 * 1024;
export class ProjectFileError extends Error {
  constructor(public code: ProjectError) {
    super(code);
  }
}
function fail(code: ProjectError): never {
  throw new ProjectFileError(code);
}
async function digest(source: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(source));
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function object(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.keys(value).includes(key))
  )
    fail("invalid_format");
}
function text(value: unknown, max: number): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > max ||
    value.includes("\0") ||
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      encoder.encode(value),
    ) !== value
  )
    fail("invalid_project");
}
/** Browser portability checks only. Native commands repeat validation in the Rust host. */
export async function validateDocument(
  value: unknown,
): Promise<ProjectDocument> {
  object(value, ["format", "formatVersion", "project"]);
  if (value.format !== "castglean-project") fail("invalid_format");
  if (value.formatVersion !== 1) fail("unsupported_version");
  const p = value.project;
  object(p, ["id", "title", "description", "chapters"]);
  text(p.id, 128);
  if (p.id === "sample") fail("invalid_project");
  text(p.title, 80);
  if (
    typeof p.description !== "string" ||
    Array.from(p.description).length > 500 ||
    p.description.includes("\0")
  )
    fail("invalid_project");
  if (
    !Array.isArray(p.chapters) ||
    !p.chapters.length ||
    p.chapters.length > 50
  )
    fail("invalid_project");
  const ids = new Set<string>();
  let total = 0;
  for (const c of p.chapters) {
    object(c, ["id", "title", "filename", "source", "sourceSha256"]);
    text(c.id, 128);
    text(c.title, 120);
    text(c.filename, 255);
    text(c.source, Number.MAX_SAFE_INTEGER);
    if (ids.has(c.id)) fail("invalid_project");
    ids.add(c.id);
    const size = encoder.encode(c.source).length;
    total += size;
    if (size > MAX_SOURCE || total > MAX_TOTAL) fail("too_large");
    if ((await digest(c.source)) !== c.sourceSha256) fail("checksum_mismatch");
  }
  return value as unknown as ProjectDocument;
}
function input(project: PreviewProject): ProjectInput {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    chapters: project.chapters.map(({ id, title, filename, source }) => ({
      id,
      title,
      filename,
      source,
    })),
  };
}
export type FileState = {
  kind: "saved" | "exported" | "opened";
  filename: string;
};
export function fromDocument(
  document: ProjectDocument,
  fileState: FileState,
): PreviewProject {
  return {
    ...document.project,
    fileState,
    chapters: document.project.chapters.map((c) => ({
      ...c,
      bytes: encoder.encode(c.source).length,
      characters: Array.from(c.source).length,
    })),
  };
}
export async function saveProjectFile(
  project: PreviewProject,
): Promise<FileState | null> {
  if (desktop) {
    const receipt = await commands.saveProject(input(project));
    return receipt ? { kind: "saved", filename: receipt.filename } : null;
  }
  const p = input(project);
  const document = await validateDocument({
    format: "castglean-project",
    formatVersion: 1,
    project: {
      ...p,
      chapters: await Promise.all(
        p.chapters.map(async (c) => ({
          ...c,
          sourceSha256: await digest(c.source),
        })),
      ),
    },
  });
  const filename = `${
    Array.from(project.title)
      .filter((c) => (c.codePointAt(0) ?? 0) >= 32 && !'<>:"/\\|?*'.includes(c))
      .slice(0, 60)
      .join("")
      .trim() || "project"
  }.castglean`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = documentLink(url, filename);
  link.click();
  link.remove();
  // Keep the object URL alive while the browser starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { kind: "exported", filename };
}
function documentLink(url: string, filename: string) {
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.append(link);
  return link;
}
export async function openProjectFile(
  file?: File,
): Promise<PreviewProject | null> {
  if (desktop) {
    const receipt = await commands.openProject();
    return receipt
      ? fromDocument(receipt.document, {
          kind: "saved",
          filename: receipt.filename,
        })
      : null;
  }
  if (!file) return null;
  if (file.size > MAX_DOCUMENT) fail("too_large");
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      ),
    );
  } catch {
    return fail("invalid_format");
  }
  const document = await validateDocument(value);
  return fromDocument(document, { kind: "opened", filename: file.name });
}
