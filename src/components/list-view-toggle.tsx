import { Trans } from "@lingui/react/macro";
import { LayoutGridIcon, Rows3Icon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ListView = "cards" | "table";

/** 列表视图切换（卡片 / 表格）。值由调用方持久化，默认视图因页面而异。 */
export function ListViewToggle({
  value,
  onChange,
}: {
  value: ListView;
  onChange: (view: ListView) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next === "cards" ? "cards" : "table")}
    >
      <TabsList>
        <TabsTrigger value="cards">
          <LayoutGridIcon />
          <span className="sr-only">
            <Trans comment="以卡片网格浏览列表">卡片视图</Trans>
          </span>
        </TabsTrigger>
        <TabsTrigger value="table">
          <Rows3Icon />
          <span className="sr-only">
            <Trans comment="以紧凑表格浏览列表">表格视图</Trans>
          </span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
