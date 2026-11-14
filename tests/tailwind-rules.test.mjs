import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("Tailwind rules reject raw colors, arbitrary values, restyled components and dynamic class strings", () => {
  const dir = mkdtempSync(join(tmpdir(), "castglean-tailwind-rules-"));
  try {
    const config = JSON.parse(readFileSync("biome.json", "utf8"));
    config.root = true;
    config.files.includes = ["**/*.tsx"];
    config.tailwind.stylesheet = resolve("src/index.css");
    config.linter.rules.nursery.noTailwindRestyledComponents = "error";
    writeFileSync(join(dir, "biome.json"), JSON.stringify(config));
    const file = join(dir, "probe.tsx");
    const run = (content) => {
      writeFileSync(file, content);
      return spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, "--only=nursery/noTailwindRawColors", "--only=nursery/noTailwindArbitraryValue", "--only=nursery/noTailwindRestyledComponents", "--only=nursery/useTailwindStaticClassStrings", file], { encoding: "utf8" });
    };
    const valid = run('const x = <><div className="bg-primary text-foreground" /><Button variant="outline" className="w-full mt-4" /></>;');
    assert.equal(valid.status, 0, valid.stderr);
    for (const [category, source] of [
      ["noTailwindRawColors", '<div className="hover:bg-emerald-600/80" />'],
      ["noTailwindArbitraryValue", '<div className="bg-[#245b50]" />'],
      ["noTailwindRestyledComponents", '<Button className="rounded-none bg-primary p-4" />'],
      ["useTailwindStaticClassStrings", '<div className={`bg-${color}-600`} />'],
    ]) {
      const result = run(`const x = ${source};`);
      assert.notEqual(result.status, 0, `${category} did not fail`);
      assert.match(result.stderr, new RegExp(category));
    }
    writeFileSync(join(dir, "biome.json"), JSON.stringify(config));
    const newBusinessFile = join(dir, "src/new-page.tsx");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(newBusinessFile, 'const x = <Button className="bg-primary" />;');
    const newBusinessResult = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, newBusinessFile], { encoding: "utf8" });
    assert.notEqual(newBusinessResult.status, 0);
    assert.match(newBusinessResult.stderr, /noTailwindRestyledComponents/);
    const scoped = join(dir, "src/components/projects/design-candidates.tsx");
    mkdirSync(join(dir, "src/components/projects"), { recursive: true });
    writeFileSync(scoped, 'const x = <Button className="bg-[#245b50] p-4" />;');
    const scopedResult = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, scoped], { encoding: "utf8" });
    assert.notEqual(scopedResult.status, 0);
    assert.match(scopedResult.stderr, /noTailwindArbitraryValue/);
    assert.match(scopedResult.stderr, /noTailwindRestyledComponents/);
    const audition = join(dir, "src/components/voices/audition-panel.tsx");
    mkdirSync(join(dir, "src/components/voices"), { recursive: true });
    writeFileSync(audition, 'const x = <FieldGroup className="gap-3" />;');
    const auditionResult = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, audition], { encoding: "utf8" });
    assert.notEqual(auditionResult.status, 0);
    assert.match(auditionResult.stderr, /noTailwindRestyledComponents/);
    const boundary = join(dir, "src/components/analysis/boundary-editor.tsx");
    mkdirSync(join(dir, "src/components/analysis"), { recursive: true });
    writeFileSync(boundary, 'const x = <Textarea className="min-h-32 leading-7" />;');
    const boundaryAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, boundary], { encoding: "utf8" });
    assert.equal(boundaryAllowed.status, 0, boundaryAllowed.stderr);
    writeFileSync(boundary, 'const x = <Textarea className="leading-8 bg-primary" />;');
    const boundaryRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, boundary], { encoding: "utf8" });
    assert.notEqual(boundaryRejected.status, 0);
    assert.match(boundaryRejected.stderr, /noTailwindRestyledComponents/);
    const logo = join(dir, "src/components/models/model-logo.tsx");
    mkdirSync(join(dir, "src/components/models"), { recursive: true });
    writeFileSync(logo, 'const x = <CpuIcon className="text-muted-foreground p-0.5" />;');
    const logoAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, logo], { encoding: "utf8" });
    assert.equal(logoAllowed.status, 0, logoAllowed.stderr);
    writeFileSync(logo, 'const x = <CpuIcon className="bg-primary" />;');
    const logoRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, logo], { encoding: "utf8" });
    assert.notEqual(logoRejected.status, 0);
    assert.match(logoRejected.stderr, /noTailwindRestyledComponents/);
    for (const path of ["src/components/models/model-center.tsx", "src/components/voices/design-resources.tsx"]) {
      const target = join(dir, path);
      mkdirSync(join(dir, path.slice(0, path.lastIndexOf("/"))), { recursive: true });
      writeFileSync(target, 'const x = <><DialogContent padding="none" /><div className="resource-card-columns @min-[560px]:resource-model-columns" /></>;');
      const allowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, target], { encoding: "utf8" });
      assert.equal(allowed.status, 0, allowed.stderr);
      writeFileSync(target, 'const x = <><DialogContent className="p-0 bg-primary" /><div className="grid-cols-[1fr_2fr]" /></>;');
      const rejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, target], { encoding: "utf8" });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /noTailwindArbitraryValue/);
      assert.match(rejected.stderr, /noTailwindRestyledComponents/);
    }
    const modelSelect = join(dir, "src/components/models/model-select.tsx");
    writeFileSync(modelSelect, 'const x = <Button className="bg-primary" />;');
    const modelSelectRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, modelSelect], { encoding: "utf8" });
    assert.notEqual(modelSelectRejected.status, 0);
    assert.match(modelSelectRejected.stderr, /noTailwindRestyledComponents/);
    const feedback = join(dir, "src/components/models/model-resource-feedback.tsx");
    writeFileSync(feedback, 'const x = <><AlertTriangleIcon className="text-destructive" /><Button variant="link" size="inline" /><Progress tone="muted" /></>;');
    const feedbackAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, feedback], { encoding: "utf8" });
    assert.equal(feedbackAllowed.status, 0, feedbackAllowed.stderr);
    writeFileSync(feedback, 'const x = <Progress className="bg-primary" />;');
    const feedbackRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, feedback], { encoding: "utf8" });
    assert.notEqual(feedbackRejected.status, 0);
    assert.match(feedbackRejected.stderr, /noTailwindRestyledComponents/);
    const picker = join(dir, "src/components/ai-elements/model-picker.tsx");
    mkdirSync(join(dir, "src/components/ai-elements"), { recursive: true });
    writeFileSync(picker, 'const x = <><Button size="picker" /><ChevronDownIcon className="opacity-60" /></>;');
    const pickerAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, picker], { encoding: "utf8" });
    assert.equal(pickerAllowed.status, 0, pickerAllowed.stderr);
    writeFileSync(picker, 'const x = <Button className="px-3" />;');
    const pickerRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, picker], { encoding: "utf8" });
    assert.notEqual(pickerRejected.status, 0);
    assert.match(pickerRejected.stderr, /noTailwindRestyledComponents/);
    const sessionInput = join(dir, "src/components/ai-elements/session-input.tsx");
    writeFileSync(sessionInput, 'const x = <InputGroupTextarea className="px-3" />;');
    const sessionInputRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, sessionInput], { encoding: "utf8" });
    assert.notEqual(sessionInputRejected.status, 0);
    assert.match(sessionInputRejected.stderr, /noTailwindRestyledComponents/);
    const settingsPanel = join(dir, "src/components/settings/settings-panel.tsx");
    mkdirSync(join(dir, "src/components/settings"), { recursive: true });
    writeFileSync(settingsPanel, 'const x = <Button size="row" className="w-full justify-start" />;');
    const rowAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, settingsPanel], { encoding: "utf8" });
    assert.equal(rowAllowed.status, 0, rowAllowed.stderr);
    writeFileSync(settingsPanel, 'const x = <Button className="rounded-item px-2" />;');
    const rowRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, settingsPanel], { encoding: "utf8" });
    assert.notEqual(rowRejected.status, 0);
    assert.match(rowRejected.stderr, /noTailwindRestyledComponents/);
    const sidebar = join(dir, "src/components/library-sidebar.tsx");
    writeFileSync(sidebar, 'const x = <><Button size="row" className="justify-start" /><SettingsIcon className="text-muted-foreground" /></>;');
    const sidebarAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, sidebar], { encoding: "utf8" });
    assert.equal(sidebarAllowed.status, 0, sidebarAllowed.stderr);
    writeFileSync(sidebar, 'const x = <Button className="px-2.5 rounded-item" />;');
    const sidebarRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, sidebar], { encoding: "utf8" });
    assert.notEqual(sidebarRejected.status, 0);
    assert.match(sidebarRejected.stderr, /noTailwindRestyledComponents/);
    const voiceLibrary = join(dir, "src/components/voices/voice-library.tsx");
    writeFileSync(voiceLibrary, 'const x = <AppState placement="list" />;');
    const libraryAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, voiceLibrary], { encoding: "utf8" });
    assert.equal(libraryAllowed.status, 0, libraryAllowed.stderr);
    writeFileSync(voiceLibrary, 'const x = <AppState className="bg-primary px-4" />;');
    const libraryRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, voiceLibrary], { encoding: "utf8" });
    assert.notEqual(libraryRejected.status, 0);
    assert.match(libraryRejected.stderr, /noTailwindRestyledComponents/);
    for (const path of ["src/routes/new.tsx", "src/components/projects/chapter-voice-panel.tsx", "src/components/voices/voice-candidate-card.tsx"]) {
      const target = join(dir, path);
      mkdirSync(join(dir, path.slice(0, path.lastIndexOf("/"))), { recursive: true });
      writeFileSync(target, 'const x = <Button className="bg-primary" />;');
      const rejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, target], { encoding: "utf8" });
      assert.notEqual(rejected.status, 0, `${path} must enforce component styling`);
      assert.match(rejected.stderr, /noTailwindRestyledComponents/);
    }
    const home = join(dir, "src/routes/index.tsx");
    writeFileSync(home, 'const x = <Link className="hover:bg-accent/60 rounded-item p-3" />;');
    const homeAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, home], { encoding: "utf8" });
    assert.equal(homeAllowed.status, 0, homeAllowed.stderr);
    writeFileSync(home, 'const x = <Link className="bg-primary" />;');
    const homeRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, home], { encoding: "utf8" });
    assert.notEqual(homeRejected.status, 0);
    assert.match(homeRejected.stderr, /noTailwindRestyledComponents/);
    const characterList = join(dir, "src/components/projects/character-target-list.tsx");
    writeFileSync(characterList, 'const x = <Button size="detail-row" variant="selected" />;');
    const characterAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, characterList], { encoding: "utf8" });
    assert.equal(characterAllowed.status, 0, characterAllowed.stderr);
    writeFileSync(characterList, 'const x = <Button className="px-3 bg-accent" />;');
    const characterRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, characterList], { encoding: "utf8" });
    assert.notEqual(characterRejected.status, 0);
    assert.match(characterRejected.stderr, /noTailwindRestyledComponents/);
    const directory = join(dir, "src/components/projects/chapter-directory.tsx");
    writeFileSync(directory, 'const x = <><TabsList size="icon"><TabsTrigger size="icon" /></TabsList><Empty className="gap-3" /></>;');
    const directoryAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, directory], { encoding: "utf8" });
    assert.equal(directoryAllowed.status, 0, directoryAllowed.stderr);
    writeFileSync(directory, 'const x = <TabsTrigger className="p-2" />;');
    const directoryRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, directory], { encoding: "utf8" });
    assert.notEqual(directoryRejected.status, 0);
    assert.match(directoryRejected.stderr, /noTailwindRestyledComponents/);
    const diagnostics = join(dir, "src/components/projects/chapter-diagnostics.tsx");
    writeFileSync(diagnostics, 'const x = <NativeSelect density="compact" className="flex-1" />;');
    const diagnosticsAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, diagnostics], { encoding: "utf8" });
    assert.equal(diagnosticsAllowed.status, 0, diagnosticsAllowed.stderr);
    writeFileSync(diagnostics, 'const x = <NativeSelect className="px-4" />;');
    const diagnosticsRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, diagnostics], { encoding: "utf8" });
    assert.notEqual(diagnosticsRejected.status, 0);
    assert.match(diagnosticsRejected.stderr, /noTailwindRestyledComponents/);
    const stateComponent = join(dir, "src/components/app-state.tsx");
    writeFileSync(stateComponent, 'const x = <><Empty className="p-4" /><Icon className="text-destructive motion-safe:animate-spin" /></>;');
    const stateAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, stateComponent], { encoding: "utf8" });
    assert.equal(stateAllowed.status, 0, stateAllowed.stderr);
    writeFileSync(stateComponent, 'const x = <Empty className="bg-primary" />;');
    const stateRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, stateComponent], { encoding: "utf8" });
    assert.notEqual(stateRejected.status, 0);
    assert.match(stateRejected.stderr, /noTailwindRestyledComponents/);
    const importDialog = join(dir, "src/components/voices/import-voice-dialog.tsx");
    writeFileSync(importDialog, 'const x = <DialogContent className="max-h-[85vh]" />;');
    const importRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, importDialog], { encoding: "utf8" });
    assert.notEqual(importRejected.status, 0);
    assert.match(importRejected.stderr, /noTailwindArbitraryValue/);
    const primitive = join(dir, "src/components/ui/checkbox.tsx");
    mkdirSync(join(dir, "src/components/ui"), { recursive: true });
    const newPrimitive = join(dir, "src/components/ui/new-primitive.tsx");
    writeFileSync(newPrimitive, 'const x = <Button className="bg-primary" />;');
    const newPrimitiveResult = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, newPrimitive], { encoding: "utf8" });
    assert.notEqual(newPrimitiveResult.status, 0);
    assert.match(newPrimitiveResult.stderr, /noTailwindRestyledComponents/);
    for (const [name, allowed, rejected] of [
      ["separator", '<SeparatorPrimitive className="bg-border" />', '<SeparatorPrimitive className="bg-primary" />'],
      ["search-input", '<Input className="px-9 border-border/50" />', '<Input className="px-9 bg-primary" />'],
      ["sidebar", '<SheetContent className="bg-sidebar p-0" />', '<SheetContent className="bg-primary" />'],
      ["progress", '<ProgressPrimitive.Track className="bg-muted rounded-full" />', '<ProgressPrimitive.Track className="bg-primary" />'],
    ]) {
      const path = join(dir, `src/components/ui/${name}.tsx`);
      writeFileSync(path, `const x = ${allowed};`);
      const ok = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, path], { encoding: "utf8" });
      assert.equal(ok.status, 0, ok.stderr);
      writeFileSync(path, `const x = ${rejected};`);
      const bad = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, path], { encoding: "utf8" });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /noTailwindRestyledComponents/);
    }
    for (const [name, component] of [
      ["alert-dialog", "AlertDialogPrimitive.Popup"], ["checkbox", "CheckboxPrimitive.Root"],
      ["combobox", "ComboboxPrimitive.Popup"], ["dialog", "DialogPrimitive.Popup"],
      ["dropdown-menu", "MenuPrimitive.Popup"], ["field", "Label"],
      ["input-group", "Input"], ["popover", "PopoverPrimitive.Popup"],
      ["radio-group", "RadioPrimitive.Root"], ["select", "SelectPrimitive.Popup"],
      ["sheet", "SheetPrimitive.Popup"], ["slider", "SliderPrimitive.Thumb"],
      ["switch", "SwitchPrimitive.Root"], ["tabs", "TabsPrimitive.Tab"],
      ["tooltip", "TooltipPrimitive.Popup"], ["trace", "CollapsibleTrigger"],
    ]) {
      const path = join(dir, `src/components/ui/${name}.tsx`);
      writeFileSync(path, `const x = <${component} className="rounded-3xl" />;`);
      const rejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, path], { encoding: "utf8" });
      assert.notEqual(rejected.status, 0, `${name} definition must reject unregistered visual classes`);
      assert.match(rejected.stderr, /noTailwindRestyledComponents/);
    }
    writeFileSync(primitive, 'const x = <div className="rounded-[7px]" />;');
    const primitiveResult = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, primitive], { encoding: "utf8" });
    assert.notEqual(primitiveResult.status, 0);
    assert.match(primitiveResult.stderr, /noTailwindArbitraryValue/);
    const switchPrimitive = join(dir, "src/components/ui/switch.tsx");
    writeFileSync(switchPrimitive, 'const x = <div className="h-[18.4px]" />;');
    const switchResult = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, switchPrimitive], { encoding: "utf8" });
    assert.notEqual(switchResult.status, 0);
    assert.match(switchResult.stderr, /noTailwindArbitraryValue/);
    const dialog = join(dir, "src/components/ui/dialog.tsx");
    writeFileSync(dialog, 'const x = <div className="max-h-[85vh]" />;');
    const dialogAllowed = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, dialog], { encoding: "utf8" });
    assert.equal(dialogAllowed.status, 0, dialogAllowed.stderr);
    writeFileSync(dialog, 'const x = <div className="max-h-[86vh]" />;');
    const dialogRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, dialog], { encoding: "utf8" });
    assert.notEqual(dialogRejected.status, 0);
    assert.match(dialogRejected.stderr, /noTailwindArbitraryValue/);
    const unrelated = join(dir, "src/unrelated.tsx");
    writeFileSync(unrelated, 'const x = <div className="max-h-[85vh]" />;');
    const unrelatedRejected = spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, unrelated], { encoding: "utf8" });
    assert.notEqual(unrelatedRejected.status, 0);
    assert.match(unrelatedRejected.stderr, /noTailwindArbitraryValue/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
