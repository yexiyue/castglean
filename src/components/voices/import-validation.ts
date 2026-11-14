import { z } from "zod";

export const importDraftSchema = z.object({
  included: z.array(z.number().int().nonnegative()),
  choices: z.record(z.string(), z.enum(["", "Import", "ImportAsNew", "Skip"])),
  excluded: z.array(z.string()),
  descriptions: z.record(z.string(), z.string()),
});

export const importEntriesSchema = z
  .array(
    z.object({
      index: z.number().int().nonnegative(),
      originalId: z.string(),
      action: z.enum(["", "Import", "ImportAsNew", "Skip"]),
      description: z.string(),
      existingDescription: z.string(),
    }),
  )
  .superRefine((entries, context) => {
    const originalIds = new Set<string>();
    entries.forEach((entry, index) => {
      if (!entry.action)
        context.addIssue({
          code: "custom",
          message: "action",
          path: [index, "action"],
        });
      if (
        (entry.action === "Import" || entry.action === "ImportAsNew") &&
        !entry.existingDescription.trim() &&
        !entry.description.trim()
      )
        context.addIssue({
          code: "custom",
          message: "description",
          path: [index, "description"],
        });
      if (entry.action === "Import") {
        if (originalIds.has(entry.originalId))
          context.addIssue({
            code: "custom",
            message: "duplicate",
            path: [index, "originalId"],
          });
        originalIds.add(entry.originalId);
      }
    });
  });
