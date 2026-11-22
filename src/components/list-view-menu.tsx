import { Trans } from "@lingui/react/macro";
import { ChevronDownIcon, LayoutGridIcon, Rows3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ListView = "cards" | "table";

export function ListViewMenu({
  value,
  onChange,
}: {
  value: ListView;
  onChange: (view: ListView) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" />}>
        <Trans comment="打开选择卡片或表格布局的菜单">视图</Trans>
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="data-[slot=dropdown-menu-content]:min-w-36">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) =>
            onChange(next === "cards" ? "cards" : "table")
          }
        >
          <DropdownMenuRadioItem
            value="cards"
            className="whitespace-nowrap"
            closeOnClick
          >
            <LayoutGridIcon />
            <Trans comment="以卡片网格浏览列表">卡片视图</Trans>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="table"
            className="whitespace-nowrap"
            closeOnClick
          >
            <Rows3Icon />
            <Trans comment="以紧凑表格浏览列表">表格视图</Trans>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
