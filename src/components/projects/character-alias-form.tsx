import { zodResolver } from "@hookform/resolvers/zod";
import { Trans } from "@lingui/react/macro";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useWorkspaceState } from "@/lib/desktop-session";

const schema = z.object({
  name: z
    .string()
    .refine((name) => !!name.trim() && [...name].length <= 120, "name"),
  reason: z.string().refine((reason) => !!reason.trim(), "reason"),
});
const empty = { name: "", reason: "" };

export function CharacterAliasForm({
  projectId,
  draftKey,
  busy,
  onSubmit,
}: {
  projectId: string;
  draftKey: string;
  busy: boolean;
  onSubmit: (draft: z.infer<typeof schema>) => void;
}) {
  const id = useId();
  const registry = useBindingOperations(projectId);
  const [draft, setDraft] = useWorkspaceState(projectId, draftKey, empty);
  const form = useForm({ defaultValues: draft, resolver: zodResolver(schema) });
  const values = form.watch();
  const update = (field: "name" | "reason", value: string) => {
    form.setValue(field, value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
    setDraft((previous) => ({ ...previous, [field]: value }));
    const next = form.getValues();
    registry.setDraftDirty(draftKey, !!next.name || !!next.reason);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
    >
      <FieldGroup>
        <Field data-invalid={!!form.formState.errors.name}>
          <FieldLabel htmlFor={`${id}-name`}>
            <Trans>添加别名</Trans>
          </FieldLabel>
          <Input
            id={`${id}-name`}
            ref={form.register("name").ref}
            value={values.name}
            aria-invalid={!!form.formState.errors.name}
            aria-describedby={
              form.formState.errors.name ? `${id}-name-error` : undefined
            }
            onChange={(event) => update("name", event.target.value)}
          />
          <FieldError id={`${id}-name-error`}>
            {form.formState.errors.name && (
              <Trans>请输入不超过 120 个字符的别名。</Trans>
            )}
          </FieldError>
        </Field>
        <Field data-invalid={!!form.formState.errors.reason}>
          <FieldLabel htmlFor={`${id}-reason`}>
            <Trans>所选原文如何支持此别名</Trans>
          </FieldLabel>
          <Input
            id={`${id}-reason`}
            ref={form.register("reason").ref}
            value={values.reason}
            aria-invalid={!!form.formState.errors.reason}
            aria-describedby={
              form.formState.errors.reason ? `${id}-reason-error` : undefined
            }
            onChange={(event) => update("reason", event.target.value)}
          />
          <FieldError id={`${id}-reason-error`}>
            {form.formState.errors.reason && (
              <Trans>请说明所选原文的依据。</Trans>
            )}
          </FieldError>
        </Field>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || (!values.name && !values.reason)}
          onClick={() => {
            form.reset(empty);
            setDraft(empty);
            registry.setDraftDirty(draftKey, false);
          }}
        >
          <Trans>清除别名草稿</Trans>
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          <Trans>确认别名关系</Trans>
        </Button>
      </div>
    </form>
  );
}
