import type { Interrupt } from "@ag-ui/core";
import {
  useAgUiInterrupts,
  useAgUiSubmitInterruptResponses,
} from "@assistant-ui/react-ag-ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceState } from "@/lib/desktop-session";
import { CastingApproval } from "./casting-approval";

const answersSchema = z.object({ answers: z.array(z.string().trim().min(1)) });

type Props = {
  projectId: string;
  sessionId: string;
  interrupts: readonly unknown[];
  blocked: boolean;
  accept: (submit: () => Promise<void>) => Promise<void>;
};

/** All answers travel through the official runtime as one resume operation. */
export function AgentQuestionGroup(props: Props) {
  const [interrupt] = props.interrupts as readonly Interrupt[];
  if (
    props.interrupts.length === 1 &&
    interrupt?.reason === "casting_audition_approval"
  ) {
    return (
      <CastingApproval
        key={interrupt.id}
        projectId={props.projectId}
        interrupt={interrupt}
        blocked={props.blocked}
        accept={props.accept}
      />
    );
  }
  return (
    <TextQuestionGroup
      projectId={props.projectId}
      sessionId={props.sessionId}
      interrupts={props.interrupts}
      blocked={props.blocked}
      accept={props.accept}
    />
  );
}

function TextQuestionGroup({
  projectId,
  sessionId,
  interrupts,
  blocked,
  accept,
}: Props) {
  const { t } = useLingui();
  const id = useId();
  const submit = useAgUiSubmitInterruptResponses();
  const [drafts, setDrafts] = useWorkspaceState<Record<string, string>>(
    projectId,
    `agentAnswers:${sessionId}`,
    {},
  );
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const composing = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const questions = interrupts as readonly Interrupt[];
  const runtimeInterrupts = useAgUiInterrupts();
  const ready = questions.every((question) =>
    runtimeInterrupts.some((current) => current.id === question.id),
  );
  const fields = useForm({
    resolver: zodResolver(answersSchema),
    values: { answers: questions.map((question) => drafts[question.id] ?? "") },
  });
  const invalid = !!fields.formState.errors.answers;
  const supported = questions.every(
    (q) =>
      (q.responseSchema as { type?: string } | undefined)?.type === "string",
  );
  return (
    <form
      ref={form}
      id={`agent-answers-${sessionId}`}
      aria-label={t`任务回答`}
      className="space-y-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          blocked ||
          !ready ||
          busy.current ||
          composing.current ||
          !supported
        )
          return;
        void fields.handleSubmit(
          async ({ answers }) => {
            busy.current = true;
            setSending(true);
            setFailed(false);
            const sent = questions.map((q, index) => ({
              interruptId: q.id,
              status: "resolved" as const,
              payload: answers[index],
            }));
            try {
              await accept(() => submit(sent));
              setDrafts((current) => {
                const next = { ...current };
                for (const q of questions)
                  if (next[q.id] === drafts[q.id]) delete next[q.id];
                return next;
              });
            } catch {
              setFailed(true);
              form.current?.querySelector("textarea")?.focus();
            } finally {
              busy.current = false;
              setSending(false);
            }
          },
          (errors) => {
            const index = errors.answers?.findIndex?.((error) => !!error) ?? 0;
            form.current
              ?.querySelectorAll("textarea")
              [Math.max(index, 0)]?.focus();
          },
        )(event);
      }}
    >
      {questions.map((question, index) => (
        <Field key={question.id}>
          <FieldLabel
            htmlFor={`${id}-${index}`}
            className="wrap-anywhere whitespace-pre-wrap"
          >
            {question.message ?? t`任务需要你的回答`}
          </FieldLabel>
          {supported ? (
            <Controller
              control={fields.control}
              name={`answers.${index}`}
              render={({ field }) => (
                <Textarea
                  id={`${id}-${index}`}
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  aria-required="true"
                  aria-invalid={!!fields.formState.errors.answers?.[index]}
                  aria-describedby={
                    fields.formState.errors.answers?.[index]
                      ? `${id}-error`
                      : undefined
                  }
                  disabled={sending || blocked}
                  className="max-h-40 min-h-20"
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onChange={(event) => {
                    field.onChange(event);
                    const value = event.target.value;
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: value,
                    }));
                  }}
                />
              )}
            />
          ) : null}
        </Field>
      ))}
      {!supported ? (
        <p role="status" className="text-xs text-muted-foreground">
          <Trans>此问题的回答形式暂不支持，已保留任务。</Trans>
        </p>
      ) : null}
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          <Trans>请填写全部回答后继续。</Trans>
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          <Trans>回答未能提交，输入已保留。受理未确认时请先核对原请求。</Trans>
        </p>
      ) : null}
      {supported && !ready ? (
        <p role="status" className="text-xs text-muted-foreground">
          <Trans>正在恢复回答入口…</Trans>
        </p>
      ) : null}
      {supported ? (
        <Button type="submit" size="sm" disabled={sending || blocked || !ready}>
          {sending ? (
            <Trans>正在提交回答…</Trans>
          ) : (
            <Trans>提交回答并继续任务</Trans>
          )}
        </Button>
      ) : null}
    </form>
  );
}
