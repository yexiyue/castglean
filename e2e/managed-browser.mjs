import { test as base } from "@playwright/test";

// Some flows intentionally open several independent sessions in one test.
export const test = base.extend({
  flowBrowser: async ({ browser }, use) => {
    const contexts = new Set();
    const close = async () => {
      await Promise.all([...contexts].map((context) => context.close()));
      contexts.clear();
    };
    const flowBrowser = {
      async newContext(options) {
        const context = await browser.newContext(options);
        contexts.add(context);
        return context;
      },
      async newPage(options) {
        const context = await this.newContext(options);
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(60000);
        return page;
      },
      close,
    };
    try {
      await use(flowBrowser);
    } finally {
      await close();
    }
  },
});
