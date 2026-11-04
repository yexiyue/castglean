import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  MicIcon,
  UserRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { useSampleVoiceBindings } from "@/hooks/use-sample-voice-bindings";

export function VoiceUsage({ voiceId }: { voiceId: string }) {
  const { t } = useLingui();
  const { bindings: allBindings } = useSampleVoiceBindings();
  const bindings = allBindings.filter((binding) => binding.voiceId === voiceId);
  const projectIds = [...new Set(bindings.map((binding) => binding.projectId))];
  return (
    <section
      data-slot="voice-usage"
      aria-labelledby="voice-usage-title"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="voice-usage-title" className="text-sm font-medium">
          <Trans comment="音色详情中的反向工程与角色引用列表">使用此音色</Trans>
        </h2>
        <Badge variant="outline">
          <Trans comment="只展示设计用绑定，不是真实工程引用">示例引用</Trans>
        </Badge>
      </div>
      {bindings.length > 0 ? (
        <>
          <p className="text-muted-foreground text-xs">
            <Plural
              comment="使用当前音色的示例工程数量"
              value={projectIds.length}
              one="# 个工程"
              other="# 个工程"
            />{" "}
            ·{" "}
            <Plural
              comment="当前音色的示例声音绑定数量，包含角色和旁白"
              value={bindings.length}
              one="# 处使用"
              other="# 处使用"
            />
          </p>
          {projectIds.map((projectId) => (
            <div
              key={projectId}
              className="border-border overflow-hidden rounded-lg border"
            >
              <div className="bg-muted/30 flex items-center gap-2 px-3 py-2.5 text-sm font-medium">
                <BookOpenIcon className="text-muted-foreground size-4 shrink-0" />
                <Trans comment="示例小说工程名称">夜航灯</Trans>
              </div>
              <ul className="divide-border divide-y">
                {bindings
                  .filter((binding) => binding.projectId === projectId)
                  .map((binding) => {
                    const label =
                      binding.kind === "narration"
                        ? t({
                            comment: "朗读职能，不是小说人物身份",
                            message: "旁白",
                          })
                        : binding.characterName;
                    return (
                      <li key={binding.id}>
                        <Link
                          data-binding-link={binding.id}
                          to="/project/$id"
                          params={{ id: projectId }}
                          search={{
                            section: "characters",
                            binding: binding.id,
                          }}
                          aria-label={t({
                            comment:
                              "跳转到音色引用的工程角色或朗读职能，label 为其名称",
                            message: `在工程中查看：${label}`,
                          })}
                          className="hover:bg-muted/50 focus-visible:ring-ring flex items-center gap-3 p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                        >
                          {binding.kind === "narration" ? (
                            <MicIcon className="text-muted-foreground size-4 shrink-0" />
                          ) : (
                            <UserRoundIcon className="text-muted-foreground size-4 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{label}</p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              {binding.kind === "narration" ? (
                                <Trans comment="旁白属于朗读职能，不计为人物">
                                  朗读职能
                                </Trans>
                              ) : (
                                <Trans comment="小说中有独立稳定身份的人物">
                                  人物角色
                                </Trans>
                              )}
                            </p>
                          </div>
                          <ArrowUpRightIcon className="text-muted-foreground size-4 shrink-0" />
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <Empty className="bg-muted/30 p-4">
          <EmptyHeader>
            <EmptyTitle>
              <Trans>暂无示例引用</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>该音色尚未用于示例工程。</Trans>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="text-muted-foreground text-xs leading-5">
        <Trans>仅展示示例绑定，真实工程引用尚未接入。</Trans>
      </p>
    </section>
  );
}
