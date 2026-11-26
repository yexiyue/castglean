import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";

const [app, originalPid] = process.argv.slice(2);
const endpoint = "http://127.0.0.1:9222";
const candidateData = join(process.env.APPDATA, "com.yexiyue.castglean.rc");
const marker = join(candidateData, "updater-acceptance-marker.txt");
const updated = "0.1.0-rc.8";
const execFile = promisify(execFileCallback);
const wait = { timeout: 180_000 };

async function connect() {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 3000 });
  const page = browser.contexts().flatMap((context) => context.pages()).find(
    (entry) => new URL(entry.url()).hostname.endsWith("tauri.localhost"),
  );
  if (!page) {
    await browser.close();
    throw new Error("The installed application WebView is unavailable");
  }
  return { browser, page };
}

async function retry(action, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await delay(1000);
    }
  } while (Date.now() < deadline);
  throw lastError;
}

async function settings(page, version) {
  await page.goto(new URL("/settings?section=about", page.url()).href, { timeout: 5000 });
  await expect(page.getByText(version, { exact: true })).toBeVisible({ timeout: 5000 });
}

const { browser, page } = await retry(connect, 60_000);
try {
  await settings(page, "0.1.0-rc.7");
  await mkdir(candidateData, { recursive: true });
  await writeFile(marker, "RC 7 data before update\n", { flag: "wx" });

  const download = page.getByRole("button", { name: /^(Download update|下载更新)$/ });
  const check = page.getByRole("button", { name: /^(Check for updates|检查更新)$/ });
  if (await check.isEnabled().catch(() => false)) await check.click();
  await expect(page.getByText(/^(Version 0\.1\.0-rc\.8 is available|可用版本 0\.1\.0-rc\.8)$/)).toBeVisible(wait);
  await download.click();
  const install = page.getByRole("button", { name: /^(Install and restart|安装并重启)$/ });
  await expect(install).toBeVisible(wait);
  console.log("RC 7 discovered and verified the signed RC 8 asset through its real WebView.");
  try {
    await install.evaluate((button) => button.click());
  } catch (error) {
    if (!page.isClosed()) throw error;
  }
  await retry(() => {
    try {
      process.kill(Number(originalPid), 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    throw new Error("The RC 7 process is still running after the install request");
  }, 90_000);
  console.log("RC 7 exited after its real update installation request.");
} finally {
  await browser.close();
}

// NSIS starts the updated app without the runner's WebView2 CDP environment.
const logRoots = [process.env.LOCALAPPDATA, process.env.APPDATA].map(
  (root) => join(root, "com.yexiyue.castglean.rc", "logs"),
);
const startup = await retry(async () => {
  for (const root of new Set(logRoots)) {
    const entries = await readdir(root).catch(() => []);
    for (const name of entries.filter((entry) => entry.startsWith("castglean.log"))) {
      const content = await readFile(join(root, name), "utf8");
      const line = content.split(/\r?\n/).find(
        (value) => value.includes('event="startup"') && value.includes(`version="${updated}"`),
      );
      if (line) return line;
    }
  }
  throw new Error(`The installed process has not recorded startup for ${updated}`);
}, 180_000);

const { stdout } = await execFile("pwsh", [
  "-NoProfile", "-Command",
  "(Get-Process castglean | Where-Object { $_.Path -eq $env:CASTGLEAN_RC_APP }).Id",
], { env: { ...process.env, CASTGLEAN_RC_APP: app }, timeout: 10000 });
const processes = stdout.trim().split(/\s+/).filter(Boolean);
if (processes.length !== 1 || processes[0] === originalPid) {
  throw new Error(`Expected a new running process at the installed path, got ${stdout.trim()}`);
}
if (await readFile(marker, "utf8") !== "RC 7 data before update\n") {
  throw new Error("Candidate data marker changed during the installed update");
}
const files = await readdir(dirname(app), { recursive: true });
const hasCudaRuntime = files.some((name) => /(?:^|[\\/])cudart64_.*\.dll$/i.test(name));
if (hasCudaRuntime !== process.env.TARGET.endsWith("-cuda")) {
  throw new Error("Installed CUDA runtime does not match the Windows update target");
}
console.log(startup);
console.log(`RC 8 restarted as PID ${processes[0]} through the installed updater, retained the RC 7 data marker, and matched ${process.env.TARGET}.`);
