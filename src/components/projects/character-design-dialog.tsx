import { Trans } from "@lingui/react/macro";
import {
  CharacterDesignForm,
  type DesignFormProps,
} from "@/components/casting/design-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CharacterDesignDialog(props: DesignFormProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent scrollable="standard">
        <DialogHeader>
          <DialogTitle>
            <Trans>为「{props.targetLabel}」设计音色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>生成候选后需试听并确认入库（描述必填），再回到绑定。</Trans>
          </DialogDescription>
        </DialogHeader>
        <CharacterDesignForm
          projectId={props.projectId}
          target={props.target}
          targetLabel={props.targetLabel}
          initial={props.initial}
          studio={props.studio}
          onClose={props.onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
