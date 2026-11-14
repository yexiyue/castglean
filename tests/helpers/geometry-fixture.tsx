import { createRoot } from "react-dom/client";
import { useState } from "react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { messages } from "../../src/locales/zh/messages.po";
import { Button } from "../../src/components/ui/button";
import { Badge } from "../../src/components/ui/badge";
import { Progress } from "../../src/components/ui/progress";
import { Skeleton } from "../../src/components/ui/skeleton";
import { SidebarProvider, Sidebar, SidebarTrigger } from "../../src/components/ui/sidebar";
import { Trace, TraceLine, TraceTitle, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent } from "../../src/components/ui/trace";
import { Checkbox } from "../../src/components/ui/checkbox";
import { Toggle } from "../../src/components/ui/toggle";
import { Input } from "../../src/components/ui/input";
import { Textarea } from "../../src/components/ui/textarea";
import { NativeSelect } from "../../src/components/ui/native-select";
import { Card } from "../../src/components/ui/card";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "../../src/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../src/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "../../src/components/ui/popover";
import { Slider } from "../../src/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "../../src/components/ui/radio-group";
import { Switch } from "../../src/components/ui/switch";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from "../../src/components/ui/sheet";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from "../../src/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "../../src/components/ui/tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "../../src/components/ui/dropdown-menu";
import { ModelLogo } from "../../src/components/models/model-logo";
import { Field, FieldDescription, FieldError, FieldLabel } from "../../src/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../../src/components/ui/input-group";
import { NumberField, NumberFieldInput } from "../../src/components/ui/number-field";
import "../../src/index.css";
i18n.load("zh", messages); i18n.activate("zh");
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");
function Geometry() {
 const [number, setNumber] = useState<number | null>(0.75);
 const [value, setValue] = useState("one");
 const [progress, setProgress] = useState(25);
 const [checked, setChecked] = useState(false);
 const [enabled, setEnabled] = useState(false);
 const [smallEnabled, setSmallEnabled] = useState(false);
 const [choice, setChoice] = useState("a");
 return <main className="bg-background text-foreground flex min-h-svh flex-col items-start gap-4 p-6">
   <Input aria-label="Input" /><Textarea aria-label="Textarea" />
   <NumberField value={number} onValueChange={setNumber} min={0} max={10} step={0.25} locale="en-US"><NumberFieldInput aria-label="Number" role="spinbutton" /></NumberField>
   <NumberField><NumberFieldInput aria-label="Invalid number" aria-invalid="true" aria-describedby="number-error" /></NumberField><span id="number-error">Number error</span>
   <NumberField disabled><NumberFieldInput aria-label="Disabled number" /></NumberField>
   <Field data-invalid><FieldLabel htmlFor="group-input">Group input</FieldLabel><InputGroup><InputGroupInput id="group-input" aria-invalid="true" aria-describedby="group-help group-error" /><InputGroupAddon align="inline-end"><InputGroupButton aria-label="Clear group" onClick={() => {}}>Clear</InputGroupButton></InputGroupAddon></InputGroup><FieldDescription id="group-help">Group help</FieldDescription><FieldError id="group-error">Group error</FieldError></Field>
   <InputGroup><InputGroupInput aria-label="Disabled group" disabled /></InputGroup>
   <Button disabled>Disabled button</Button>
   <Button size="sm" multiline>Multiline button</Button>
   <Button variant="link" size="inline">Inline link</Button><Badge variant="outline-muted">Muted badge</Badge>
   <Progress aria-label="Active progress" value={25} /><Progress aria-label="Paused progress" value={25} tone="muted" />
   <Skeleton aria-label="Loading placeholder" className="h-4 w-16" />
   <Trace><TraceCollapsible><TraceCollapsibleTrigger><TraceLine status="running"><TraceTitle>Running trace</TraceTitle></TraceLine></TraceCollapsibleTrigger><TraceCollapsibleContent>Trace details</TraceCollapsibleContent></TraceCollapsible></Trace>
   {new URLSearchParams(location.search).has("structural") && <SidebarProvider><Sidebar collapsible="icon">Sidebar test</Sidebar><SidebarTrigger /></SidebarProvider>}
   <NativeSelect aria-label="Native"><option>One</option></NativeSelect>
   {(["xs", "sm", "default", "lg", "icon-xs"] as const).map(size => <Button key={size} size={size}>{size}</Button>)}
   <Button variant="secondary">Secondary</Button><Checkbox aria-label="Check" checked={checked} onCheckedChange={setChecked} /><Toggle size="sm">Small toggle</Toggle>
   <Checkbox aria-label="Invalid checkbox" aria-invalid="true" aria-describedby="checkbox-error" /><span id="checkbox-error">Checkbox error</span><Checkbox aria-label="Disabled checkbox" disabled />
   <Switch aria-label="Enable" checked={enabled} onCheckedChange={setEnabled} />
   <Switch aria-label="Small switch" size="sm" checked={smallEnabled} onCheckedChange={setSmallEnabled} />
   <Switch aria-label="Unavailable" disabled />
   <Switch aria-label="Invalid switch" aria-invalid="true" aria-describedby="switch-error" /><span id="switch-error">Switch error</span>
   <RadioGroup aria-label="Choice" value={choice} onValueChange={setChoice}><RadioGroupItem aria-label="First" value="a" /><RadioGroupItem aria-label="Second" value="b" /></RadioGroup>
   <RadioGroup aria-label="Invalid choice"><RadioGroupItem value="invalid" aria-label="Invalid radio" aria-invalid="true" aria-describedby="radio-error" /><RadioGroupItem value="disabled" aria-label="Disabled radio" disabled /></RadioGroup><span id="radio-error">Radio error</span>
   <Select value={value} onValueChange={v => v && setValue(v)}><SelectTrigger aria-label="Select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem><SelectItem value="two">Two</SelectItem></SelectContent></Select>
   <Select><SelectTrigger aria-label="Invalid select" aria-invalid="true" aria-describedby="select-error"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select><span id="select-error">Select error</span>
   <Select disabled><SelectTrigger aria-label="Disabled select"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select>
   <output aria-label="controlled state">{`${checked}/${enabled}/${choice}/${value}`}</output>
   <Slider aria-label="Test progress" value={[progress]} min={0} max={100} step={1} onValueChange={value => setProgress(typeof value === "number" ? value : value[0])} getAriaValueText={(_, value) => `${value}%`} />
   <Card className="p-4">Surface</Card>
   <Popover><PopoverTrigger render={<Button />}>Popover</PopoverTrigger><PopoverContent>Popover content</PopoverContent></Popover>
   <DropdownMenu><DropdownMenuTrigger render={<Button />}>Menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Menu item</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger>Submenu</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Sub item</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuContent></DropdownMenu>
   <Dialog><DialogTrigger render={<Button />}>Dialog</DialogTrigger><DialogContent><DialogTitle>Geometry</DialogTitle><DialogDescription>Acceptance fixture</DialogDescription><DialogFooter><Button>Done</Button></DialogFooter></DialogContent></Dialog>
   <Sheet><SheetTrigger render={<Button />}>Sheet</SheetTrigger><SheetContent><SheetTitle>Sheet test</SheetTitle><SheetDescription>Sheet description</SheetDescription></SheetContent></Sheet>
   <AlertDialog><AlertDialogTrigger render={<Button />}>Alert</AlertDialogTrigger><AlertDialogContent><AlertDialogTitle>Alert test</AlertDialogTitle><AlertDialogDescription>Alert description</AlertDialogDescription><AlertDialogCancel>Cancel</AlertDialogCancel></AlertDialogContent></AlertDialog>
   <TooltipProvider><Tooltip><TooltipTrigger render={<Button />}>Tooltip</TooltipTrigger><TooltipContent>Tooltip text</TooltipContent></Tooltip></TooltipProvider>
   <div aria-label="model logo sizes"><ModelLogo backend="kokoro" size="sm" /><ModelLogo backend="kokoro" /><ModelLogo backend="kokoro" size="lg" /><ModelLogo backend="unknown" size="sm" /><ModelLogo backend="unknown" /><ModelLogo backend="unknown" size="lg" /></div>
 </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Geometry /></I18nProvider>);
