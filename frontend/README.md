# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Run the complete system through Nginx

From the repository root, run `bash scripts/init.sh`, then
`docker compose up --build --wait --wait-timeout 180`.
Open `http://localhost:8080/`; `/api/` requests on that origin go to the Go API.
The frontend runs as a Node SSR server on internal port 3000.
See the [root README](../README.md) for optional direct access with `compose.debug.yaml`.

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Testing

Run these commands from `frontend/` using Node.js 24.22.1 or later in the 24.x release line.

```bash
npm ci
npx playwright install chromium
```

On Linux, install the browser's system dependencies if needed:

```bash
npx playwright install --with-deps chromium
```

| Command | Checks |
| --- | --- |
| `npm run lint` | ESLint rules for JavaScript, TypeScript, and React Hooks; warnings fail the check |
| `npm run typecheck` | React Router route types and TypeScript |
| `npm test` | Vitest unit tests, run once |
| `npm run test:watch` | Vitest unit tests, rerun when files change |
| `npm run e2e` | Playwright E2E tests in Chromium |

Put unit tests beside application code as `app/**/*.test.ts(x)` or `app/**/*.spec.ts(x)`.
Vitest uses jsdom, Testing Library, and jest-dom matchers. Its separate configuration
keeps the React Router build plugin out of unit tests and excludes E2E tests.
The initial unit tests cover the welcome content, resource links, and error messages.

Put E2E tests in `e2e/*.spec.ts`. Playwright builds the application, starts the production
server at `http://127.0.0.1:4173`, and stops it after testing. Keep port 4173 available;
you do not need to start a server yourself. The initial E2E tests check the home page
and the HTTP status and content of the 404 page.

To run against the already started Compose environment through Nginx, set
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:8080 npm run e2e`. This skips starting a local
server and also checks same-origin API access from the browser. CI runs this in
the integration job and uploads a separate `nginx-playwright-results` artifact.

`npm start` runs `server.js`, which serves the production build using Express and
the React Router adapter. `TRUSTED_PROXY_CIDRS` controls the trusted proxy address
ranges for forwarded host, protocol and client IP information. It defaults to
empty for direct local runs; Compose sets private IPv4 ranges for its local network.

View the HTML report after a run:

```bash
npx playwright show-report
```

Failed tests retain screenshots and traces in `test-results/`. To inspect a trace:

```bash
npx playwright show-trace test-results/<test-directory>/trace.zip
```

CI runs lint, type checks, unit tests, and a production build in `quality`, with
Chromium E2E tests in the parallel `e2e` job. The `playwright-results` artifact
contains the report and failure diagnostics and is retained for seven days.

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
