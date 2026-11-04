import { Trans } from "@lingui/react/macro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { VoiceUsage } from "@/components/voices/voice-usage";

/** Preset design previews are deliberately separate from real asset details. */
export function VoiceDetailSheet({
  voice,
  onClose,
}: {
  voice: { id: string; name: string; tone: string; modelId: string };
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <Badge variant="outline">
            <Trans comment="预置声音详情中标记资源为界面示例">示例音色</Trans>
          </Badge>
          <SheetTitle>{voice.name}</SheetTitle>
          <SheetDescription>
            {voice.tone} · {voice.modelId}
          </SheetDescription>
        </SheetHeader>
        <div className="px-6">
          <p className="text-muted-foreground text-sm">
            <Trans>
              此声音为预置音色界面示例，暂无可试听或导出的真实资源。
            </Trans>
          </p>
          <Button className="mt-4" disabled>
            <Trans comment="预置声音试听暂未接入">试听</Trans>
          </Button>
          <VoiceUsage voiceId={voice.id} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
