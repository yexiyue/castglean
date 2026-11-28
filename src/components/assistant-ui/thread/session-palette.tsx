import { Trans, useLingui } from "@lingui/react/macro";
import { MessagesSquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list";
import { Button } from "@/components/ui/button";
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
        <ThreadList
          threads={ai.sessions}
          activeId={ai.sessionId}
          inputRef={input}
          onNew={() => {
            setOpen(false);
            onNewSession();
          }}
          onSelect={(id) => {
            setOpen(false);
            ai.selectSession(id);
          }}
        />
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
