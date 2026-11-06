import { createServer } from "node:http";

// UI tests need public configuration for the SSR loader, but never authenticate.
const config = {
  enabled: true,
  apiKey: "e2e-public-key",
  authDomain: "demo-e2e.firebaseapp.com",
  projectId: "demo-e2e",
  appId: "e2e-app",
  emulatorUrl: "",
};

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET" && request.url === "/api/auth/config") {
    response.end(JSON.stringify({ data: config }));
  } else if (request.method === "GET" && request.url === "/health") {
    response.end(JSON.stringify({ status: "ok" }));
  } else {
    response.statusCode = request.url === "/api/auth/me" ? 401 : 404;
    response.end(JSON.stringify({ error: { code: "ui_fixture_only" } }));
  }
});

server.listen(18781, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close());
}
