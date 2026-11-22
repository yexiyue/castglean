import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { AppState } from "@/components/app-state";
import { buttonVariants } from "@/components/ui/button";
import { commands, type VoiceReferenceView } from "@/lib/bindings";

/** 真实绑定数据的反向引用：哪些工程的哪个目标正在使用这个音色。 */
export function VoiceBindingUsage({ voiceId }: { voiceId: string }) {
  const { t } = useLingui();
  const [references, setReferences] = useState<
    VoiceReferenceView[] | "failed" | null
  >(null);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void commands
      .voiceBindingReferences({ kind: "library", id: voiceId })
      .then((next) => {
        if (active) setReferences(next);
      })
      .catch(() => {
        if (active) setReferences("failed");
      });
    return () => {
      active = false;
    };
  }, [voiceId]);
  if (!isTauri() || references === null) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        <Trans comment="该音色被哪些工程的目标绑定">工程引用</Trans>
      </p>
      {references === "failed" ? (
        <AppState
          compact
          kind="error"
          title={
            <Trans comment="读取音色使用记录失败，当前工程引用数量未知">
              无法读取工程引用
            </Trans>
          }
        />
      ) : references.length === 0 ? (
        <AppState compact title={<Trans>暂无工程绑定此音色。</Trans>} />
      ) : (
        references.map((reference) => (
          <Link
            key={`${reference.projectId}:${reference.target.kind === "narrator" ? "narrator" : reference.target.character_id}`}
            to="/project/$id"
            params={{ id: reference.projectId }}
            search={{ section: "characters" }}
            className={buttonVariants({
              size: "sm",
              variant: "ghost",
              className: "justify-start",
            })}
          >
            {reference.projectTitle || reference.projectId}
            {" · "}
            {reference.target.kind === "narrator" ? t`旁白` : t`角色绑定`}
          </Link>
        ))
      )}
    </section>
  );
}
