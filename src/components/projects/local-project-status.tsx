import { Trans } from "@lingui/react/macro";

/** Render only for a snapshot returned after a successful host commit. */
export function LocalProjectStatus() {
  return (
    <span role="status">
      <Trans comment="工程已提交到本机数据库">已自动保存</Trans>
    </span>
  );
}
