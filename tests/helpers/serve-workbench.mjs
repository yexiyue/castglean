import { createServer } from "vite";
const server = await createServer({
  cacheDir: "src-tauri/target/vite-workbench-fixture",
  server: { port: 1437, strictPort: true },
  plugins: [{ name: "isolated-workbench-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/__boundary-recovery') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/boundary-recovery-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__segment-recovery') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/segment-recovery-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__candidate-recovery') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/candidate-recovery-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__split-confirm') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/split-confirm-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__heading-rules') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/heading-rules-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__wave-player') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/wave-player-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__pause-form') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/pause-form-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__voice-name-form') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/voice-name-form-fixture.tsx"></script></body></html>'));
        return;
      }
      if (url.pathname === '/__geometry') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__geometry', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/geometry-fixture.tsx"></script></body></html>'));
        return;
      }
      if (!url.searchParams.has('fixture') || !req.headers.accept?.includes('text/html')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/desktop-fixture.tsx"></script></body></html>'));
    });
    server.middlewares.use('/__workbench' , async (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/__workbench', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/helpers/workbench-fixture.tsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
console.log('Isolated workbench fixture: http://localhost:1437/__workbench');
