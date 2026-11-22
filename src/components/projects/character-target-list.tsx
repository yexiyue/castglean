import { Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

/** 单字身份标识；旁白用声音线条图标区分叙述身份与角色身份。 */
function RowChip({ title, narrator }: { title: string; narrator: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs leading-none text-muted-foreground"
    >
      {narrator ? (
        <AudioLinesIcon className="size-3" />
      ) : (
        ([...title][0] ?? "·")
      )}
    </span>
  );
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
      type="button"
      variant="ghost"
      data-character-directory-row=""
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(row)}
      className={cn(
        "h-11 w-full justify-start gap-2 rounded-md px-2 text-left font-normal hover:bg-muted/70",
        active && "bg-accent/50 text-foreground hover:bg-accent/65",
      )}
    >
      <RowChip
        title={title}
        narrator={row.kind === "target" && row.target.kind === "narrator"}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex w-full items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm leading-5",
              active && "font-medium",
            )}
          >
            {title}
          </span>
          {badge ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {badge}
            </span>
          ) : null}
          {suggested ? (
            <Badge variant="warning" className="shrink-0">
              <Trans>待审</Trans>
            </Badge>
          ) : null}
        </span>
        {row.kind === "target" ? (
          <span
            className={cn(
              "truncate text-xs leading-4",
              invalid ? "text-destructive" : "text-muted-foreground",
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
    <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
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
}: {
  characters: Character[];
  hasSuggestion: (target: BindingTarget) => boolean;
  bindingFor: (target: BindingTarget) => BindingStateView_Serialize | null;
  query: string;
  onQueryChange: (value: string) => void;
  selection: CenterSelection | null;
  onSelect: (row: CenterSelection) => void;
  voiceName: (voice: VoiceRef) => string;
}) {
  const { t } = useLingui();
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (c: Character) =>
    !normalized || c.displayName.toLocaleLowerCase().includes(normalized);
  const roles = characters.filter((c) => matches(c));

  const narratorTarget: BindingTarget = { kind: "narrator" };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <SearchInput
          variant="quiet"
          value={query}
          onValueChange={onQueryChange}
          placeholder={t`搜索角色…`}
          aria-label={t`搜索角色`}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pb-2">
        <Row
          selection={selection}
          row={{ kind: "target", target: narratorTarget }}
          title={t`旁白`}
          binding={bindingFor(narratorTarget)}
          suggested={hasSuggestion(narratorTarget)}
          onSelect={onSelect}
          voiceName={voiceName}
        />
        <div className="mx-2 border-t" />
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
          <p className="px-3 py-4 text-xs text-muted-foreground">
            <Trans>先分析章节，角色身份会出现在这里。</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
