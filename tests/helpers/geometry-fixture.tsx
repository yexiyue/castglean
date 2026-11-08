import { createRoot } from "react-dom/client";
import { useState } from "react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { messages } from "../../src/locales/zh/messages.po";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Textarea } from "../../src/components/ui/textarea";
import { NativeSelect } from "../../src/components/ui/native-select";
import { Card } from "../../src/components/ui/card";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "../../src/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../src/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "../../src/components/ui/popover";
import "../../src/index.css";
i18n.load("zh", messages); i18n.activate("zh");
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");
function Geometry() {
 const [value, setValue] = useState("one");
 return <main className="bg-background text-foreground flex min-h-svh flex-col items-start gap-4 p-6">
   <Input aria-label="Input" /><Textarea aria-label="Textarea" />
   <NativeSelect aria-label="Native"><option>One</option></NativeSelect>
   {(["xs", "sm", "default", "lg", "icon-xs"] as const).map(size => <Button key={size} size={size}>{size}</Button>)}
   <Select value={value} onValueChange={v => v && setValue(v)}><SelectTrigger aria-label="Select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select>
   <Card className="p-4">Surface</Card>
   <Popover><PopoverTrigger render={<Button />}>Popover</PopoverTrigger><PopoverContent>Popover content</PopoverContent></Popover>
   <Dialog><DialogTrigger render={<Button />}>Dialog</DialogTrigger><DialogContent><DialogTitle>Geometry</DialogTitle><DialogDescription>Acceptance fixture</DialogDescription><DialogFooter><Button>Done</Button></DialogFooter></DialogContent></Dialog>
 </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Geometry /></I18nProvider>);
