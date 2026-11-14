import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { appHotkeys } from "@/lib/hotkeys";

const descriptions = {
  "session.send": { name: msg`发送助手消息`, scope: msg`助手输入框聚焦时` },
  "workspace.toggleDirectory": {
    name: msg`显示或收起目录`,
    scope: msg`章节工作台`,
  },
  "workspace.toggleInspector": {
    name: msg`显示或收起辅助面板`,
    scope: msg`章节阅读视图`,
  },
  "structure.jumpToChapter": {
    name: msg`转到来源行`,
    scope: msg`章节阅读视图`,
  },
  "audio.dragCancel": { name: msg`取消音轨拖动`, scope: msg`拖动音轨边界时` },
} satisfies Partial<
  Record<
    keyof typeof appHotkeys,
    { name: ReturnType<typeof msg>; scope: ReturnType<typeof msg> }
  >
>;

export function ShortcutHelp() {
  const { t } = useLingui();
  return (
    <dl className="divide-y">
      {(Object.keys(descriptions) as Array<keyof typeof descriptions>).map(
        (id) => (
          <div
            key={id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <dt className="min-w-0 text-sm">
              <span className="block">{t(descriptions[id].name)}</span>
              <span className="text-muted-foreground text-xs">
                {t(descriptions[id].scope)}
              </span>
            </dt>
            <dd>
              <kbd className="bg-muted rounded-control border px-2 py-1 text-xs whitespace-nowrap">
                {appHotkeys[id].hotkey ? (
                  formatForDisplay(appHotkeys[id].hotkey)
                ) : (
                  <Trans>未设置</Trans>
                )}
              </kbd>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
