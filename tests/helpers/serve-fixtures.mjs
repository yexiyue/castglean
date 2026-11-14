import { createServer } from "vite";

const fixtures = new Map([
  ["/__boundary-recovery", "boundary-recovery"],
  ["/__segment-recovery", "segment-recovery"],
  ["/__candidate-recovery", "candidate-recovery"],
  ["/__split-confirm", "split-confirm"],
  ["/__heading-rules", "heading-rules"],
  ["/__wave-player", "wave-player"],
  ["/__pause-form", "pause-form"],
  ["/__voice-name-form", "voice-name-form"],
  ["/__geometry", "geometry"],
]);

const server = await createServer({
  cacheDir: "src-tauri/target/vite-e2e-fixture",
  optimizeDeps: { entries: ["tests/helpers/*.tsx", "src/main.tsx"] },
  server: { port: 1437, strictPort: true },
  plugins: [{
    name: "isolated-e2e-fixtures",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        const desktop = url.searchParams.has("fixture") && req.headers.accept?.includes("text/html");
        let fixture = fixtures.get(url.pathname);
        if (!fixture && desktop) fixture = "desktop";
        if (!fixture) return next();
        res.setHeader("Content-Type", "text/html");
        const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/${fixture}-fixture.tsx"></script></body></html>`;
        res.end(await server.transformIndexHtml(url.pathname, html));
      });
    },
  }],
});
await server.listen();
console.log("Isolated test fixtures: http://localhost:1437");
