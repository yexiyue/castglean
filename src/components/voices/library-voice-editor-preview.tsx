import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LibraryVoiceEditor,
  type LibraryVoiceFeedback,
} from "./library-voice-editor";

export function LibraryVoiceEditorPreview() {
  const { t } = useLingui();
  const savedName = t({
    message: "旁白音色",
    comment: "音色库编辑示例中的已保存名称",
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LibraryVoiceFeedback>("save-error");
  return (
    <section id="voice-library-edit-states" className="scroll-mt-6 space-y-5">
      <h2 className="text-base font-semibold">
        <Trans>音色库编辑与删除示例</Trans>
      </h2>
      <p className="text-muted-foreground text-sm">
        <Trans>
          可编辑示例名称、撤销修改或切换反馈状态；不会保存、删除或播放真实音色。
        </Trans>
      </p>
      <div className="grid max-w-4xl items-start gap-5 md:grid-cols-2">
        <div className="rounded-md border p-4">
          <LibraryVoiceEditor
            name={draft ?? savedName}
            savedName={savedName}
            onNameChange={setDraft}
            onReset={() => setDraft(null)}
          />
        </div>
        <div className="space-y-5 rounded-md border p-4">
          <label className="flex flex-col gap-2 text-sm">
            <Trans comment="切换演示状态，不执行真实操作">反馈状态示例</Trans>
            <select
              className="border-input bg-background rounded-md border p-2"
              value={feedback}
              onChange={(event) =>
                setFeedback(event.target.value as LibraryVoiceFeedback)
              }
            >
              <option value="saving">
                <Trans>正在保存名称…</Trans>
              </option>
              <option value="saved">
                <Trans>名称已保存。</Trans>
              </option>
              <option value="save-error">
                <Trans comment="演示名称保存失败状态">名称保存失败</Trans>
              </option>
              <option value="deleting">
                <Trans comment="演示等待系统删除确认状态">等待删除确认</Trans>
              </option>
              <option value="cancelled">
                <Trans comment="演示用户取消删除状态">已取消删除</Trans>
              </option>
              <option value="delete-error">
                <Trans comment="演示音色删除失败状态">音色删除失败</Trans>
              </option>
            </select>
          </label>
          <LibraryVoiceEditor
            name={feedback === "save-error" ? `${savedName} 2` : savedName}
            savedName={savedName}
            feedback={feedback}
            busy={feedback === "saving" || feedback === "deleting"}
          />
        </div>
      </div>
    </section>
  );
}
