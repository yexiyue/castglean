import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import type {
  BindingStateView_Serialize,
  BindingTarget,
  Character,
  VoiceRef,
} from "@/lib/bindings";
import { cn } from "@/lib/utils";
import { sameTarget } from "@/lib/voice-audition";

/** All validated roles use the same binding-target interaction. */
export type CenterSelection = { kind: "target"; target: BindingTarget };
function selectedRow(
  selection: CenterSelection | null,
  row: CenterSelection,
): boolean {
  return !!selection && sameTarget(selection.target, row.target);
}

function Row({
  selection,
  row,
  title,
  binding,
  suggested,
  badge,
  onSelect,
  voiceName,
}: {
  selection: CenterSelection | null;
  row: CenterSelection;
  title: string;
  binding: BindingStateView_Serialize | null;
  suggested?: boolean;
  badge?: string;
  onSelect: (row: CenterSelection) => void;
  voiceName: (voice: VoiceRef) => string;
}) {
  const active = selectedRow(selection, row);
  const voice = binding?.voice ?? null;
  const invalid = voice && binding?.validity && binding.validity !== "valid";
  return (
    <Button
      variant={active ? "selected" : "ghost"}
      size="detail-row"
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(row)}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex w-full items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              active && "font-medium",
            )}
          >
            {title}
          </span>
          {badge ? (
            <span className="text-muted-foreground shrink-0 text-xs">
              {badge}
            </span>
          ) : null}
          {suggested ? (
            <span className="text-warning-foreground shrink-0 text-xs">
              <Trans>待审</Trans>
            </span>
          ) : null}
        </span>
        {row.kind === "target" ? (
          <span
            className={cn(
              "text-xs",
              voice && !invalid
                ? active
                  ? "text-accent-foreground/70"
                  : "text-muted-foreground"
                : "text-muted-foreground/70",
              invalid && "text-warning-foreground",
            )}
          >
            {voice ? (
              invalid ? (
                <Trans>绑定音色已失效</Trans>
              ) : (
                voiceName(voice)
              )
            ) : (
              <Trans>未绑定</Trans>
            )}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground/80 px-3 pt-4 pb-1 text-xs tracking-wide">
      {children}
    </p>
  );
}

/**
 * Master list of the character center: narrator pinned first, confirmed
 * characters with their binding summary and pending-suggestion markers, and
 * candidate identities grouped at the end.
 */
export function CharacterTargetList({
  characters,
  hasSuggestion,
  bindingFor,
  query,
  onQueryChange,
  selection,
  onSelect,
  voiceName,
  footer,
}: {
  characters: Character[];
  hasSuggestion: (target: BindingTarget) => boolean;
  bindingFor: (target: BindingTarget) => BindingStateView_Serialize | null;
  query: string;
  onQueryChange: (value: string) => void;
  selection: CenterSelection | null;
  onSelect: (row: CenterSelection) => void;
  voiceName: (voice: VoiceRef) => string;
  /** 渲染在滚动流末尾的内容（任务、折叠审计块）：出现与展开只延长滚动，不压缩列表。 */
  footer?: React.ReactNode;
}) {
  const { t } = useLingui();
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (c: Character) =>
    !normalized || c.displayName.toLocaleLowerCase().includes(normalized);
  const roles = characters.filter((c) => matches(c));

  const narratorTarget: BindingTarget = { kind: "narrator" };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-1 pb-1">
      <div className="px-2 pb-1">
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          placeholder={t`搜索角色…`}
          aria-label={t`搜索角色`}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Row
          selection={selection}
          row={{ kind: "target", target: narratorTarget }}
          title={t`旁白`}
          binding={bindingFor(narratorTarget)}
          suggested={hasSuggestion(narratorTarget)}
          onSelect={onSelect}
          voiceName={voiceName}
        />
        <div className="border-t" />
        {roles.length ? (
          <GroupLabel>
            <Trans>角色（{roles.length}）</Trans>
          </GroupLabel>
        ) : null}
        {roles.map((c) => {
          const target: BindingTarget = {
            kind: "character",
            character_id: c.id,
          };
          return (
            <Row
              key={c.id}
              selection={selection}
              row={{ kind: "target", target }}
              title={c.displayName}
              binding={bindingFor(target)}
              suggested={hasSuggestion(target)}
              onSelect={onSelect}
              voiceName={voiceName}
            />
          );
        })}
        {!characters.length ? (
          <p className="text-muted-foreground px-3 py-4 text-xs">
            <Trans>先分析章节，角色身份会出现在这里。</Trans>
          </p>
        ) : null}
        {footer ? <div className="mt-2 flex flex-col">{footer}</div> : null}
      </div>
    </div>
  );
}
