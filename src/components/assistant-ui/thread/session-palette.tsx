import { Trans, useLingui } from "@lingui/react/macro";
import { CheckIcon, MessagesSquareIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { useAiSession } from "@/hooks/use-ai-session";

export function SessionPalette({
  ai,
  onNewSession = ai.newSession,
}: {
  ai: ReturnType<typeof useAiSession>;
  onNewSession?: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const newSession = { id: "", title: t`新建会话` };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="icon-sm" variant="ghost" />}
        aria-label={t`切换会话`}
        title={t`切换会话`}
      >
        <MessagesSquareIcon />
      </DialogTrigger>
      <DialogContent initialFocus={input} scrollable="standard">
        <DialogTitle>
          <Trans>切换会话</Trans>
        </DialogTitle>
        <Combobox<{ id: string; title: string }>
          inline
          open
          autoHighlight
          items={[newSession, ...ai.sessions]}
          itemToStringLabel={(session) => session.title}
          itemToStringValue={(session) => session.id}
          onValueChange={(session) => {
            if (!session) return;
            setOpen(false);
            if (session.id === newSession.id) onNewSession();
            else ai.selectSession(session.id);
          }}
        >
          <ComboboxInput
            ref={input}
            aria-label={t`搜索会话`}
            placeholder={t`搜索会话`}
            showTrigger={false}
          />
          <ComboboxEmpty className="[&:not(:empty)]:flex">
            <Trans>未找到会话</Trans>
          </ComboboxEmpty>
          <ComboboxList
            aria-label={t`会话`}
            className="max-h-64 shrink overflow-y-auto"
          >
            {(session) => (
              <ComboboxItem
                key={session.id}
                value={session}
                aria-current={session.id === ai.sessionId || undefined}
                className="min-h-8"
              >
                {session.id === newSession.id ? <PlusIcon /> : null}
                <span className="min-w-0 flex-1 truncate" title={session.title}>
                  {session.title}
                </span>
                {session.id === ai.sessionId ? <CheckIcon aria-hidden /> : null}
              </ComboboxItem>
            )}
          </ComboboxList>
        </Combobox>
        {ai.hasMoreSessions ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              try {
                await ai.loadSessions();
              } finally {
                setLoadingMore(false);
              }
            }}
          >
            <Trans>读取更多会话</Trans>
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
