# Firebase Authenticationの設定と確認

メールアドレス・パスワードとGoogleログインは、どちらもFirebase Authenticationを使います。Google以外のメールアドレスも登録できます。パスワード、メール確認、パスワード再設定はFirebaseが管理し、Go APIやPostgreSQLにはパスワードを保存しません。

一般ユーザー・業者ユーザー・システム管理者は同じログイン画面を使います。認証と業務上の権限を分け、担当者への明示的な紐付けがない利用者には業務アクセスを許可しません。

## Firebaseプロジェクトの準備

1. Firebase ConsoleでプロジェクトにWebアプリを追加し、Authenticationを開始します。
2. Sign-in methodで「メール / パスワード」と「Google」を有効にします。Googleにはサポート用メールアドレスを設定します。
3. Authenticationの承認済みドメインに、公開サイトのドメインを追加します。ローカルで実Firebaseを使う場合は`localhost`も明示的に登録します。
4. メールのテンプレート、確認・再設定メールの送信元を設定し、パスワードポリシーとメール列挙保護を有効にします。
5. Webアプリの設定を`.env`に指定します。以下はブラウザーに公開されるWeb設定です。サービスアカウント秘密鍵は入れません。

```dotenv
APP_ENV=production
AUTH_PUBLIC_URL=https://mobiltracer.example.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_API_KEY=your-web-api-key
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_APP_ID=your-web-app-id
AUTH_SESSION_TTL=120h
SYSTEM_ADMIN_EMAILS=admin@example.com
FIREBASE_CREDENTIALS_FILE=/absolute/path/outside-repository/firebase-admin.json
```

Go APIはApplication Default CredentialsでFirebase Admin SDKを初期化します。Google Cloud上では実行サービスアカウントに必要なFirebase Authenticationの参照・セッション作成権限を付与します。ローカルComposeでは、リポジトリ外に保管したサービスアカウントJSONを次の追加設定でバックエンドだけにマウントできます。

```bash
docker compose -f compose.yaml -f compose.firebase.yaml up --build -d --wait
```

HTTPを使えるのは`APP_ENV=development`または`test`のループバックURLだけです。本番はHTTPSを使用します。以前の`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_CALLBACK_URL`・`AUTH_JWT_*`・`AUTH_ACCESS_TTL`は使用しません。Googleへの直接コールバックの代わりに、FirebaseがOAuthを処理します。

WSL2からCloudflare Tunnelで公開する場合は、[公開・運用手順](hosting.md)に従って`bash scripts/public.sh`を使います。公開構成ではホストのポート開放を解除し、実FirebaseとHTTPSを必須にします。

## Firebaseをクラウドに作らずローカルで確認する

```bash
bash scripts/init.sh
docker compose -f compose.yaml -f compose.firebase-emulator.yaml up --build -d --wait
```

`http://localhost:8080/login`を開きます。`NGINX_PORT`を変えた場合はそのポートを使います。エミュレーターは`localhost:9099`で待ち受けます。確認メール・再設定メールのリンクは次のログに出ます。Googleログインのポップアップもエミュレーターのテスト画面です。

```bash
docker compose -f compose.yaml -f compose.firebase-emulator.yaml logs -f firebase-auth
```

この構成は`demo-mobile-tracer`プロジェクトと署名なしの開発トークンを使用します。実Googleアカウントや実メール送信は使いません。エミュレーター設定がある本番環境ではAPIの起動を拒否します。認証データは終了時に専用ボリュームへエクスポートします。

Dockerを使わない場合はNode.jsとFirebase CLIを用意し、ルートの`firebase.json`で`firebase emulators:start --only auth --project demo-mobile-tracer`を実行します。Go APIには次を指定します。

```dotenv
APP_ENV=development
AUTH_PUBLIC_URL=http://localhost:8080
FIREBASE_PROJECT_ID=demo-mobile-tracer
FIREBASE_API_KEY=demo-api-key
FIREBASE_AUTH_DOMAIN=demo-mobile-tracer.firebaseapp.com
FIREBASE_APP_ID=demo-app-id
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIREBASE_AUTH_EMULATOR_URL=http://localhost:9099
```

## 担当者との紐付け

Firebase ConsoleのAuthentication > UsersでUIDを確認し、運用担当者が既存の担当者IDへ明示的に紐付けます。エミュレーターのUIDは`/emulator/v1/projects/demo-mobile-tracer/accounts`でも確認できます。メールアドレスの一致だけでは紐付けません。

```bash
docker compose exec backend /app/auth-link --firebase-uid 'FIREBASE_UID' --staff-id 'STAFF_UUID'
# 取消し
docker compose exec backend /app/auth-link --firebase-uid 'FIREBASE_UID' --staff-id 'STAFF_UUID' --remove
```

`FIREBASE_PROJECT_ID`とUIDの組み合わせが本人識別子です。同じFirebaseユーザーへプロバイダーが連携されていれば、メール・パスワードとGoogleで同じ業務上の紐付けを使えます。プロバイダーの自動連携方針はFirebaseの設定に従います。別UID間の業務権限をメールから自動統合しません。

システム管理者はFirebaseが確認済みとしたメールと`SYSTEM_ADMIN_EMAILS`をサーバーで照合します。画面遷移だけでなく、ユーザー・企業・申請を管理する`/api/admin/*`でも確認します。管理者指定だけでは顧客・店舗・担当案件の業務権限は付与しません。

## セッションと認証API

ブラウザーのFirebase SDKはメモリー内だけで認証情報を保持します。ログイン後はIDトークンをGo APIへ渡し、FirebaseのセッションCookieに交換してからSDKをサインアウトします。トークンをlocalStorageやSSRのloaderデータへ保存しません。

| 方法 | パス | 内容 |
| --- | --- | --- |
| GET | `/api/auth/config` | Webアプリ用の公開設定と有効状態 |
| GET | `/api/auth/login-challenge` | 5分有効・一回限りのログインCSRFトークンとHttpOnlyのブラウザー結び付けCookie |
| POST | `/api/auth/session` | JSON `{ "id_token": "..." }`。同じオリジンと`X-CSRF-Token`が必要 |
| GET | `/api/auth/me` | 本人、紐付け済み所属、選択中の担当者、管理者判定、セッションCSRFトークン |
| POST | `/api/auth/membership` | JSON `{ "staff_id": "..." }`で有効な紐付けから選択 |
| POST | `/api/auth/logout` | 現在のアプリセッションをDBで失効し、Cookieを消す |
| GET | `/api/admin/context` | システム管理者だけが参照できる本人情報 |

Firebase Admin SDKでIDトークンの署名・発行者・対象プロジェクト・期限・失効・アカウント停止を検証します。確認済みメールと、5分以内の`auth_time`を必要とします。業務APIではIDトークンのBearer送信を直接受け付けず、FirebaseセッションCookieとアプリセッションIDの組み合わせを検証します。

本番Cookieは`__Host-mt_session`と`__Host-mt_session_id`がHttpOnly・Secure・Path=/・SameSite=Lax、CSRF用は`__Host-mt_csrf`です。ローカルHTTPでは`mt_`接頭辞を使います。DBにはCookie本体を保存せずSHA-256ハッシュを保存します。同じFirebase Cookieが発行されてもアプリのログインごとにセッションIDを分け、ログアウト済みのセッションは再利用できません。

セッションの有効期間は既定5日、設定範囲は5分〜14日です。期限後は再ログインします。独自のJWT発行・リフレッシュトークン更新は行いません。Firebaseの停止・失効は毎リクエスト、アプリのユーザー・セッション・担当者・顧客・役割も毎リクエスト確認します。Firebaseへの検証に失敗した場合はアクセスを拒否します。ログアウトは現在のアプリセッションが対象で、他端末のセッションを一括失効する操作ではありません。

更新系API・所属選択・ログアウトでは、ブラウザーのOriginまたはRefererと、Cookie・DBハッシュに一致するCSRFトークンを検証します。SSRはCookieを内部APIに転送し、認証情報をブラウザー向けデータに含めません。固定BearerトークンはFirebase有効時には使えず、本番では開発用認証を禁止します。

認証成功・失敗・ログアウト・紐付け変更は監査履歴に記録します。APIログへパスワード、IDトークン、Cookie、Firebaseの生のエラーを記録しません。

## Migration

適用済みの`000003_google_auth.up.sql`は変更せず、`000004_firebase_auth.up.sql`を追加しています。既存DBでは旧アプリJWTのセッションを失効させます。旧Google本人識別子・紐付け・OAuthフロー・更新トークンの履歴は保持します。業務記録・写真の参照情報・検証情報は変更しません。

旧Googleの`sub`とFirebase UIDは別の識別子です。移行後はFirebaseでログインし、UIDを確認した上で担当者を再紐付けしてください。メールだけで既存権限を移しません。新規DBにはMigration 1〜4を順に適用します。期間経過による業務記録の自動削除は行いません。

## 検証

ブラウザーの認証テストは`TEST_FIREBASE_BROWSER=1 npm run e2e -- --grep "Firebase Authentication"`で実行します。Go APIにはテスト用DBとエミュレーターを設定し、`AUTH_PUBLIC_URL=http://127.0.0.1:4173`、フロントエンドには`API_INTERNAL_URL`でそのGo APIを指定してください。ブラウザーからのAPI通信はテスト内で同じAPIへ中継し、SSRは直接APIを参照します。起動済みのSSRサーバーを使う場合は`PLAYWRIGHT_BASE_URL`もそのURLに設定します。

Goの認証結合テストと業務APIの結合テストは`TEST_DATABASE=1 go test -race ./...`で実行します。DBにはテスト用データベースを作成できる権限が必要です。認証単体テストはFirebaseの実アカウントに依存しません。エミュレーターを起動して`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 TEST_DATABASE=1 go test -race ./internal/authn -run TestFirebaseEmulator`を実行すると、実Admin SDKでメール・パスワードとGoogleプロバイダー、セッション発行、業務アクセス、ログアウト、アカウント停止を確認できます。

手動確認では以下を確認します。

1. Google以外のメールで新規登録し、確認前には業務セッションが作られず、確認リンクを開いた後はログインできる。
2. 誤ったパスワードではログインできず、パスワード再設定メールから変更できる。
3. Googleログインが成功し、ポップアップのキャンセル・失敗時に秘密情報を含まないメッセージが出る。
4. 紐付け後の`/account`に担当者・役割が表示される。複数所属は紐付け済みの所属だけを選択できる。
5. 未紐付けアカウントは本人ページのみ参照でき、他社・他店舗・担当外の業務情報を参照できない。
6. ログアウト後のCookie再送を拒否する。役割取消し・担当者や顧客の停止が次のリクエストから反映される。
7. 確認済み管理者メールのみ`/admin`へアクセスできる。

クラウドでのGoogleログイン、実メールの配送、承認済みドメインは実Firebaseプロジェクトの設定後に確認してください。

Firebase公式資料: [メール・パスワード](https://firebase.google.com/docs/auth/web/password-auth)、[Googleログイン](https://firebase.google.com/docs/auth/web/google-signin)、[セッションCookie](https://firebase.google.com/docs/auth/admin/manage-cookies)、[Auth Emulator](https://firebase.google.com/docs/emulator-suite/connect_auth)。

## ユーザー区分・企業・申請

`000005_user_company_requests.up.sql`で一般・業者区分と企業プロファイル、審査履歴を追加します。一般ユーザーから業者ユーザーへの変更は申請し、システム管理者の承認後に反映します。業者ユーザーは企業とプロファイルの作成、所属企業のプロファイル変更を申請できます。管理者は全申請を一元管理し、承認・拒否できます。画面・API・移行の詳細は[ユーザー・企業・申請の管理](user-company-management.md)を参照してください。
