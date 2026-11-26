import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

const [app] = process.argv.slice(2);
const endpoint = "http://127.0.0.1:9222";
const candidateData = join(process.env.APPDATA, "com.yexiyue.castglean.rc");
const marker = join(candidateData, "updater-acceptance-marker.txt");
const updated = "0.1.0-rc.8";
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
  await install.evaluate((button) => { setTimeout(() => button.click(), 100); });
} finally {
  await browser.close();
}

await retry(async () => {
  const { browser: restarted, page: updatedPage } = await connect();
  try {
    await settings(updatedPage, updated);
    await expect(updatedPage.getByText(/^(You.re up to date\.|已是最新版本。)$/)).toBeVisible({ timeout: 5000 });
    if (await readFile(marker, "utf8") !== "RC 7 data before update\n") {
      throw new Error("Candidate data marker changed during the installed update");
    }
  } finally {
    await restarted.close();
  }
}, 180_000).catch((error) => {
  console.error(`Installed restart verification failed for ${app}: ${error.message}`);
  throw error;
});
console.log("RC 8 restarted from the installed path, reports current, and retained the RC 7 data marker.");
