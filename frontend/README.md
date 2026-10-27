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

## Zodによる入力検証

フォーム入力やURLパラメータなど、実行時に受け取る値はZodで検証します。
検証に成功した後は、入力値ではなく `result.data` を使います。

### スキーマの配置と型

- 画面固有のスキーマは、利用するルートと同じディレクトリの `<機能名>.schema.ts` に置きます。
- 同じルールを複数の画面で使う場合に `app/schemas/` へ移します。業務要件が異なる項目は個別に定義します。
- スキーマの変数名は `recordFormSchema` のように `Schema` で終えます。
- 型は `z.infer<typeof schema>` で導出します。変換前の型が必要な場合は `z.input`、変換後は `z.output` を使います。`z.infer` は変換後の型です。
- 必須項目、空文字、未指定値、数値への変換は各スキーマで指定します。`optional()` が許可する未指定値は `undefined` です。`null` や空文字を許可するかは別に決めます。

### フォーム入力を検証する例

以下は使い方を説明する例です。件数の1〜99という制約は、製品の業務ルールとして決めたものではありません。

```ts
import * as z from "zod";

import { toValidationErrors, validationOptions } from "~/lib/validation";

const exampleFormSchema = z.object({
  title: z.string().trim().min(1, "件名を入力してください。"),
  count: z.string().trim()
    .min(1, "件数を入力してください。")
    .regex(/^[0-9]+$/, "件数は半角数字で入力してください。")
    .pipe(z.coerce.number<string>().int()
      .min(1, "件数は1以上にしてください。")
      .max(99, "件数は99以下にしてください。")),
  note: z.string().trim().optional(),
});

type ExampleFormInput = z.input<typeof exampleFormSchema>; // count: string
type ExampleFormValues = z.infer<typeof exampleFormSchema>; // count: number

export function validateExampleForm(formData: FormData) {
  const result = exampleFormSchema.safeParse({
    title: formData.get("title"),
    count: formData.get("count"),
    note: formData.get("note") ?? undefined,
  }, validationOptions);

  if (!result.success) {
    return { success: false as const, errors: toValidationErrors(result.error) };
  }

  return { success: true as const, data: result.data };
}
```

`FormData.get()` は項目がなければ `null` を返します。この例では、必須項目の欠落はエラーにし、任意のメモだけ `undefined` に変換します。メモの空文字はそのまま許可します。`File` などの想定外の型はスキーマで拒否します。

`z.coerce.number()` は空文字を0へ変換するため、この例では空文字と数字の形式を先に検証しています。URLのクエリ値も、`URLSearchParams.get()` の結果について、未指定値と空文字をどう扱うかを決めてから検証します。

### 日本語のメッセージと画面への表示

`validationOptions` はZod標準のエラーを日本語にする検証オプションです。`safeParse` または `safeParseAsync` の第2引数に渡します。グローバル設定は変更しません。項目名や修正方法を伝えるメッセージは、上の例のようにスキーマへ記載します。スキーマ側の指定が優先されます。

`toValidationErrors(result.error)` は次の形式でメッセージを返します。

```ts
{
  formErrors: ["入力内容を確認してください。"],
  fieldErrors: {
    title: ["件名を入力してください。"],
    "members.0.name": ["名前を入力してください。"],
  },
}
```

`formErrors` は項目のパスがないエラーです。`fieldErrors` はパスごとにメッセージを配列で保持し、エラーのない項目は含めません。ネストした項目と配列は `members.0.name` のようにドットで区切ります。区別できるよう、スキーマの項目名自体にはドットを含めないでください。項目間の検証は、修正対象が決まる場合は `refine` などの `path` でその項目を指定します。

検証失敗時は送信処理を止め、入力値を維持したままエラーを表示します。たとえば `errors` が `ValidationErrors | undefined` の場合、件名欄は次のようにエラーと関連付けます。

```tsx
<label htmlFor="title">件名</label>
<input
  id="title"
  name="title"
  aria-invalid={Boolean(errors?.fieldErrors.title?.length)}
  aria-describedby={errors?.fieldErrors.title?.length ? "title-errors" : undefined}
/>
{errors?.fieldErrors.title?.length ? (
  <ul id="title-errors" role="alert">
    {errors.fieldErrors.title.map((message, index) => (
      <li key={index}>{message}</li>
    ))}
  </ul>
) : null}
{errors?.formErrors.length ? (
  <ul role="alert">
    {errors.formErrors.map((message, index) => (
      <li key={index}>{message}</li>
    ))}
  </ul>
) : null}
```

業務画面への適用は各画面の実装時に行います。APIレスポンスの検証は業務APIの仕様と接続処理に合わせて追加します。権限判定、状態遷移、DBとの整合性確認はGo APIで実装し、Go側でも受け取った値を検証します。

詳細は [Zodの基本的な使い方](https://zod.dev/basics)と[エラーメッセージの設定](https://zod.dev/error-customization)を参照してください。

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
