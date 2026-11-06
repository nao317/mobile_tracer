# WSL2からCloudflare Tunnelで公開する

公開先は`https://mbtracer.yellowtail.work`を想定しています。このラップトップのWSL2からDocker Desktopを利用し、同じDocker上のCloudflare TunnelからNginxへ転送します。Firebase Authenticationには`mobile-tracer-2d1e3`を使います。実際のDNS登録、Firebaseの管理画面設定、外部ネットワークとWindows再起動後の確認は、末尾の記録表に結果を残してください。

```text
ブラウザー → Cloudflare（HTTPS） → Tunnel → cloudflared → nginx:8080
                                                        ├ frontend:3000
                                                        └ backend:8080 → DB / Tapyrus / Esplora
```

`scripts/public.sh`は`compose.yaml`、`compose.firebase.yaml`、`compose.public.yaml`を重ねます。プロジェクト名を`mobile-tracer-public`に固定し、開発環境とはネットワーク・データボリュームを分けます。公開構成にはホストの公開ポートがありません。cloudflaredはNginxとの専用ネットワークにだけ参加し、バックエンド・DB・Tapyrusには直接接続しません。GoとSSRはNginxの固定IPだけをプロキシとして信頼します。

Tapyrusは既存の単一ノード開発チェーンを使います。HTTPS公開によって外部のTapyrusネットワークへ移行するものではありません。

## WSL2とDockerを確認する

WindowsのPowerShellでディストリビューション名とWSLのバージョンを確認します。

```powershell
wsl --version
wsl --list --verbose
```

WSL内の`/etc/wsl.conf`に次の設定を入れます。既存の他のセクションは残してください。

```ini
[boot]
systemd=true
```

設定を変えた場合はPowerShellで`wsl --shutdown`を実行してからWSLを開き直します。この操作は他のWSL環境も停止します。WSL内で確認します。

```bash
ps -p 1 -o comm=
docker info --format '{{.ServerVersion}}'
docker info --format '{{.OperatingSystem}}'
docker compose version
```

PID 1がsystemdで、Docker APIが応答することを確認します。Composeは2.24.4以降が必要です。現在の接続先はDocker Desktopで、WSL内に`docker.service`はありません。Docker Desktopの設定でこのUbuntuのWSL Integrationを有効にします。管理するデーモンは一つに決めてください。

WSL内のDocker Engineへ切り替える場合だけ、`systemctl is-active docker`と`systemctl is-enabled docker`を確認し、`sudo systemctl enable --now docker`で自動起動を有効にします。既存のDesktop用ボリュームが自動で移行されることは想定せず、データをバックアップしてから切り替えます。

systemdを有効にする方法は[Microsoftの手順](https://learn.microsoft.com/en-us/windows/wsl/systemd)、公開ポートを消す`!reset`の挙動は[Dockerのマージ仕様](https://docs.docker.com/reference/compose-file/merge/)を参照してください。

## 公開環境の設定と秘密情報を用意する

初回はリポジトリルートで実行します。すでに`.env.public`がある場合は上書きせず、内容を確認します。

```bash
umask 077
cp -n .env.public.example .env.public
mkdir -p secrets
chmod 700 secrets
chmod 600 .env.public
id -u
id -g
```

`.env.public`の設定を埋めます。

`.env.public`の所有者は、このチェックアウトを所有する運用ユーザーに合わせ、権限を`600`にします。`PUBLIC_ENV_FILE`で別のファイルを使う場合も同じ条件です。`scripts/public.sh`は、Composeがファイルを読む前に保存先・所有者・権限を検査します。systemdからrootで起動する場合も、所有者はチェックアウトの所有者と照合します。

| 変数 | 設定内容 |
| --- | --- |
| `AUTH_PUBLIC_URL` | `https://mbtracer.yellowtail.work`。末尾の`/`は付けません |
| `FIREBASE_PROJECT_ID` | `mobile-tracer-2d1e3` |
| `FIREBASE_API_KEY` | Firebase ConsoleのWebアプリ設定にあるAPIキー |
| `FIREBASE_AUTH_DOMAIN` | `mobile-tracer-2d1e3.firebaseapp.com` |
| `FIREBASE_APP_ID` | `1:693779135001:web:fc5d21766493a9fea98888` |
| `PUBLIC_UID` / `PUBLIC_GID` | 秘密情報ファイルを所有するWSLユーザーの`id -u` / `id -g` |
| `FIREBASE_CREDENTIALS_FILE` | `./secrets/firebase-admin.json`、またはその絶対パス |
| `CLOUDFLARE_TUNNEL_TOKEN_FILE` | `./secrets/tunnel-token`、またはその絶対パス |
| `POSTGRES_PASSWORD` / `TAPYRUS_RPC_PASSWORD` | 開発環境とは別のランダム値。各32バイト以上を推奨 |
| `SYSTEM_ADMIN_EMAILS` | 必要な場合のみ、確認済み管理者メールをカンマ区切りで指定 |
| `PUBLIC_APP_SUBNET` / `PUBLIC_APP_IP_RANGE` / `PUBLIC_PROXY_IP` | 既定はサブネット`172.30.72.0/24`、自動割り当て範囲`172.30.72.128/25`、Nginx固定IP`172.30.72.2`。LAN・VPNと重複する場合は3つとも変更し、固定IPは自動割り当て範囲から外します |

Web SDKはすでにnpmの`firebase`を使用し、`/api/auth/config`で公開設定を受け取って初期化します。SDKの再導入や`<script>`タグの追加は不要です。今回の認証ではAnalytics・Storage・Messagingを使用しないため、`measurementId`などは設定しません。

サービスアカウントJSONはFirebase Consoleのプロジェクト設定から用意します。対象プロジェクトとAuthenticationの参照・セッションCookie作成権限を確認し、`secrets/firebase-admin.json`に保管します。秘密鍵はフロントエンドへ渡しません。ファイル所有者を`PUBLIC_UID`に合わせ、権限を600にします。リポジトリ内での保存は、Git管理対象外の`secrets/`配下に限定します。リポジトリ外のファイルを指定する運用も可能です。

`.env.public`、サービスアカウントJSON、Tunnelトークン、バックアップはGit・Issue・PRへ記載しません。`docker compose config`は解決済みパスワードを表示するため、共有する確認結果には`config --quiet`または`check`を使います。コンテナやTunnelのデバッグログにも認証情報が含まれ得るため、通常は既定のログレベルを使います。

## CloudflareでTunnelとDNSを設定する

1. Cloudflareで`yellowtail.work`ゾーンが有効であることを確認します。
2. Cloudflare OneのNetworks / Connectors / Cloudflare Tunnelsから、cloudflaredのTunnelを作成します。例として名前を`mobile-tracer-home`にします。
3. コネクターのセットアップ画面で表示されるトークンを、ローカルのエディターで`secrets/tunnel-token`へ保存します。内容はトークン文字列だけとし、シェルのコマンド引数や履歴へ貼り付けません。
4. ファイルの所有者を`PUBLIC_UID`に合わせ、`chmod 600 secrets/tunnel-token`を実行します。
5. Published application routeにホスト名`mbtracer.yellowtail.work`、サービス種別HTTP、転送先`nginx:8080`を設定します。パス条件とHTTP Host Headerの上書きは空にします。
6. DNSに`mbtracer`のプロキシ有効CNAMEが作成されたことを確認します。手動登録が必要なら、接続先は`<Tunnel UUID>.cfargotunnel.com`です。既存の同名レコードがある場合は、用途を確認してから変更します。
7. `mbtracer.yellowtail.work`へのHTTPアクセスをHTTPSへリダイレクトするルールを設定します。ゾーン全体に適用してよければAlways Use HTTPSも使えます。
8. CloudflareのキャッシュルールでこのホストをBypassにします。認証APIや個人ページにCache Everythingを適用しません。

cloudflaredはComposeが公式コンテナを取得して動かします。WindowsサービスやWSLの別サービスとして二重に起動しません。トークンは`--token-file`で読み込み、コンテナ引数や環境変数へ値を埋め込みません。接続元ファイアウォールではTunnelに必要な外向き通信を許可し、自宅ルーターのポート転送は設定しません。

Nginxの公開設定は、専用ネットワーク上のcloudflaredが渡す通信方式を扱います。外側がHTTPSならGo・SSRへ`X-Forwarded-Proto: https`を渡し、HTTPならHTTPSへ308を返します。クライアントのHost以外の転送ヘッダーは上書きします。公開用`public.conf`をホストの待ち受けポートと組み合わせないでください。

画面の位置やトークンの扱いは[CloudflareのTunnel作成手順](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)と[実行パラメーター](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)を参照してください。

## Firebase Authenticationを設定する

Firebase Consoleでプロジェクト`mobile-tracer-2d1e3`と上記Webアプリを選び、次を設定します。提示されたWeb設定からプロジェクト・アプリIDは分かりますが、Consoleでの設定完了は別途確認が必要です。

1. AuthenticationのSign-in methodでメール／パスワードを有効にします。メールリンクのみの認証は今回使いません。
2. Googleを有効にし、プロジェクトのサポート用メールを設定します。
3. Settingsの承認済みドメインに`mbtracer.yellowtail.work`を追加します。プロトコル・パスは含めません。`FIREBASE_AUTH_DOMAIN`はFirebase既定のホスト名を維持します。
4. Templatesで確認メール・パスワード再設定メールを設定します。アプリ名、送信者名、返信先、本文の日本語を確認し、Firebase既定のアクションURLで実メールから処理を完了できることを確認します。完了後は公開URLのログイン画面へ戻ります。独自のアクションハンドラーは実装していません。
5. SettingsのPassword policyをRequireにします。運用案は12文字以上・英大文字・英小文字・数字を必須です。適用した条件を運用記録に残し、満たさないパスワードが拒否されることを確認します。
6. SettingsのUser actionsでメール列挙保護を有効にします。新しいプロジェクトの既定値に頼らず確認します。

設定箇所とポリシーの仕様は[Firebaseのパスワード認証ガイド](https://firebase.google.com/docs/auth/web/password-auth)を参照してください。認証・業務権限・担当者への紐付けの仕様は[認証の手順](auth.md)にあります。

## 起動・停止・更新・ログ確認

Tunnelの作成を待つ間は、Firebaseの秘密鍵を配置してから`bash scripts/public.sh build`と`bash scripts/public.sh prepare`を実行できます。`CLOUDFLARE_TUNNEL_TOKEN_FILE`は空のままで構いません。`prepare`はFirebaseの秘密鍵と公開構成を検査し、Nginxと依存する内部サービスだけを起動します。cloudflaredは起動せず、ホストのポートも公開しません。通常の`check`・`up`では実際のトークンファイルが必要です。

秘密情報を用意したら、公開構成を検査して初回起動します。開発用の`scripts/init.sh`やエミュレーター用Composeは使いません。公開プロジェクトの初期化とMigrationは`up`時に依存サービスとして実行されます。

```bash
bash scripts/public.sh check
bash scripts/public.sh config --quiet
bash scripts/public.sh pull
bash scripts/public.sh up --build -d --wait --wait-timeout 300
bash scripts/public.sh ps
bash scripts/public.sh exec -T nginx nginx -t
bash scripts/public.sh logs --tail=100 nginx backend cloudflared
```

`check`と`up`では、HTTPS、実Firebase、開発用認証の無効化、ホストポートの不在、秘密情報の保存場所・所有者・権限を検査します。稼働中のTunnelがCloudflare側でHealthyになり、外部URLが応答することも確認してください。Composeの`--wait`だけではCloudflareへの接続成功まで保証できません。

通常の停止は`bash scripts/public.sh stop`、再開は`bash scripts/public.sh up -d --wait --wait-timeout 300`です。サービス定義を削除する場合は`bash scripts/public.sh down`を使います。`down -v`はDB・ウォレット・署名鍵のデータを削除するため、通常運用では使いません。

更新前にバックアップを取得します。変更を確認してコードを取得し、`bash scripts/public.sh pull`と`bash scripts/public.sh up --build -d --wait --wait-timeout 300`を実行します。失敗時は`ps`と`logs --tail=100`で対象を特定します。Migration適用後に旧コードへ戻す場合はDBの互換性も確認します。

### Docker Desktopのマウントエラーから復旧する

WSL2・Docker Desktopを起動し直した後、既存コンテナの起動時に`docker-desktop-bind-mounts`や`/etc/nginx/mobile-tracer`へのマウントが`no such file or directory`で失敗することがあります。まず`ls -ld docker/nginx/includes`でホスト側の設定ディレクトリが存在することを確認します。

設定ディレクトリが存在し、API・DBなどが正常に起動している場合は、Nginxとcloudflaredを順に再作成します。古いコンテナのマウント状態を更新する操作で、イメージの再ビルドやDB・Tapyrusの再作成は不要です。

```bash
bash scripts/public.sh up -d --no-deps --force-recreate --wait --wait-timeout 60 nginx
bash scripts/public.sh up -d --no-deps --force-recreate --wait --wait-timeout 60 cloudflared
bash scripts/public.sh exec -T nginx nginx -t
```

2026-11-07にこの手順でNginxのマウントエラーを解消し、Nginxのヘルスチェックと設定検査が成功することを確認しました。公開URLの`/login`・`/api/health`・`/api/ready`もCloudflare経由でHTTPS 200を返しています。復旧のために`down -v`を実行する必要はありません。

## Windows再起動後に公開状態へ戻す

WSLが起動した後のCompose起動をsystemdで管理します。以下のサービスファイルの`WorkingDirectory`が実際の配置先に合っているか確認し、初回のビルドと起動確認を済ませてから導入します。

```bash
sudo install -m 644 docker/systemd/mobile-tracer-public.service /etc/systemd/system/mobile-tracer-public.service
sudo systemctl daemon-reload
sudo systemctl enable --now mobile-tracer-public.service
systemctl status mobile-tracer-public.service
```

現在のDocker Desktop構成では、Windowsへのログインを復帰手順に含めます。Docker Desktopの「Windowsログイン時に起動」を有効にし、WSL Integrationも有効にします。公開用systemdサービスはDocker APIが応答しない場合に15秒後に再試行します。

`Type=oneshot`と`Restart=on-failure`の組み合わせは、`ExecStartPre`や`ExecStart`が失敗した場合の再試行に対応しています。oneshotで禁止されているのは`Restart=always`と`Restart=on-success`です。[systemdの仕様](https://freedesktop.org/software/systemd/man/latest/systemd.service.html)を参照してください。手動の停止は再試行の対象になりません。

Windowsのタスクスケジューラに、WSLを所有するWindowsユーザーで次のタスクを作ります。`SYSTEM`にはそのユーザーのWSLが登録されていない場合があります。

| 項目 | 設定 |
| --- | --- |
| トリガー | Windowsログイン時。開始を30秒程度遅延 |
| 実行ユーザー | このWSLを登録したWindowsユーザー |
| プログラム | `C:\Windows\System32\wsl.exe` |
| 引数 | `-d Ubuntu-26.04 -u root --exec /bin/bash -lc "systemctl start --no-block mobile-tracer-public.service && exec sleep infinity"` |
| 再試行 | 失敗時は1分間隔で再試行。長時間実行を理由に停止しない |

`Ubuntu-26.04`は`wsl --list --verbose`に表示される名前に置き換えます。`sleep infinity`はWSLを利用するプロセスを維持します。Windowsの資格情報が必要な場合はタスクスケジューラの画面で入力し、スクリプトに保存しません。ログイン前の自動公開が必要な場合はWSL内Docker Engineを使い、起動時トリガーと所有ユーザーでの非対話実行を別途検証します。

復帰確認ではWindowsを再起動してログインし、PC外のネットワークから公開URLを開きます。WSL内で`systemctl status mobile-tracer-public.service`、`bash scripts/public.sh ps`、`journalctl -u mobile-tracer-public.service -b --no-pager`を確認します。停止したサービスの手動復旧は`sudo systemctl restart mobile-tracer-public.service`です。

常駐サービスのコンテナには`restart: unless-stopped`を指定しています。Migrationや初期化などの一回限りの処理は繰り返し再起動しません。ホストの再起動時にはsystemdの`up`で依存関係も確認します。

## スリープと電源設定

Windowsの電源設定で、AC接続中のスリープ・休止・蓋を閉じた時の動作を確認します。常時公開する間はAC接続時にスリープしない設定を使います。画面の消灯は構いません。Windows Updateの再起動後にタスクが動くことも確認します。このラップトップの停止・スリープや回線断の間は公開が停止する構成です。

## バックアップと復元

保存先はPC本体と別の媒体・サービスに決めてください。候補は外付けディスクへの暗号化保存と、暗号化したファイルのクラウド保管です。ウォレット・署名鍵・個人情報を含むため、暗号化とアクセス制限を行います。保管先・頻度・保持期間・復元確認日を末尾へ記録します。運用案は毎日1回と更新前の取得、日次7世代・週次4世代の保持です。保存先が未定の間はバックアップの完了扱いにしません。

次はメンテナンス時間に実施するバックアップ例です。`/mnt/backup/mobile-tracer`を実際の別媒体へ置き換え、マウントされていることを先に確認します。失敗したファイルは復元に使わず、サービスを戻してから原因を調べます。

```bash
set -euo pipefail
umask 077
backup_dir="/mnt/backup/mobile-tracer/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
bash scripts/public.sh stop cloudflared nginx frontend backend esplora tapyrusd
bash scripts/public.sh exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
bash scripts/public.sh run --rm --no-deps -T --user 0 --entrypoint tar tapyrusd -C /var/lib/tapyrus -czf - . > "$backup_dir/tapyrus-data.tgz"
bash scripts/public.sh run --rm --no-deps -T --user 0 --entrypoint tar tapyrusd -C /var/lib/tapyrus-auth -czf - . > "$backup_dir/tapyrus-auth.tgz"
cp .env.public "$backup_dir/environment.env"
git rev-parse HEAD > "$backup_dir/commit.txt"
tar -tzf "$backup_dir/tapyrus-data.tgz" > /dev/null
tar -tzf "$backup_dir/tapyrus-auth.tgz" > /dev/null
bash scripts/public.sh exec -T db pg_restore --list < "$backup_dir/database.dump" > /dev/null
(cd "$backup_dir" && sha256sum database.dump tapyrus-data.tgz tapyrus-auth.tgz environment.env commit.txt > SHA256SUMS)
bash scripts/public.sh up -d --wait --wait-timeout 300
```

サービスアカウント鍵とTunnelトークンは上のバックアップに入りません。管理された秘密情報保管先へ別途保存するか、Firebase・Cloudflareで再発行します。復元時は`.env.public`のファイルパス・UID/GIDを復元先に合わせます。Firebase AuthenticationのユーザーはFirebase側に保存され、PostgreSQLのバックアップには含まれません。Firebaseプロジェクト自体の削除に備える場合は、Authenticationユーザーのエクスポート方針も別途決めてください。

復元は隔離した復元先で練習し、DB、Tapyrus、環境設定を同じバックアップ時点に揃えます。次は**空の公開用ボリュームへ戻す場合だけ**の手順です。既存データがある場合は別途退避し、上書きの要否を確認します。DBの起動は`--wait`でヘルスチェック成功まで待ち、失敗時は復元へ進みません。ヘルスチェックはTCP接続を使い、初期化中の一時的なUnixソケットサーバーを準備完了と判定しないようにしています。

```bash
set -euo pipefail
backup_dir=/mnt/backup/mobile-tracer/RESTORE_TIMESTAMP
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
# commit.txtのコードを用意し、environment.envから.env.publicを復元・調整しておく。
# Firebase・Cloudflareの秘密ファイルも用意し、checkを通す。
bash scripts/public.sh check
bash scripts/public.sh stop
bash scripts/public.sh up -d --wait --wait-timeout 120 db
bash scripts/public.sh exec -T db sh -c 'exec pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_dir/database.dump"
bash scripts/public.sh run --rm --no-deps -T --user 0 --entrypoint tar tapyrusd -C /var/lib/tapyrus -xzf - < "$backup_dir/tapyrus-data.tgz"
bash scripts/public.sh run --rm --no-deps -T --user 0 --entrypoint tar tapyrusd -C /var/lib/tapyrus-auth -xzf - < "$backup_dir/tapyrus-auth.tgz"
bash scripts/public.sh up --build -d --wait --wait-timeout 300 nginx
```

Esploraの索引は空の`esplora-data`から再作成します。最後の`up`はNginxと依存する内部サービスだけを起動します。DBとチェーンの照合、ウォレット残高、既存の業務記録を確認してから、`bash scripts/public.sh up -d cloudflared`で公開を再開し、実Firebaseでのログインを確認します。旧バックアップへ戻すとログアウト等の記録も戻るため、再公開前に必要なセッション失効を行ってください。

## 公開環境での確認記録

実アカウントを使わない構成検査、起動時の再試行、DB復元、Nginxの通信検査は、次のコマンドで実行できます。systemdのテストは一時的なユーザーサービスを使います。DB復元と通信検査は専用の一時コンテナを使い、ホストのポートや実Firebaseの認証情報を使いません。CIのIntegration checksでも実行します。CIではsystemdテストに`sudo`と`--system`を指定してシステムマネージャー上で検査します。

```bash
python3 scripts/test_public.py
python3 scripts/test_public_systemd.py
python3 scripts/test_public_restore.py
python3 scripts/test_public_nginx.py
```

2026-11-06に、このラップトップの公開用コンテナを起動してTunnelを接続しました。同じラップトップから公開ドメインへHTTPSでアクセスし、Cloudflare経由で画面とAPIが応答することを確認しています。携帯回線等からの独立した接続確認、実アカウントでの認証、Windows再起動後の復帰は別途確認します。秘密情報は記録しません。

| 確認する内容 | 結果・実施日 |
| --- | --- |
| DNS、Tunnel接続、公開URLの画面・API | 2026-11-06確認済み。CloudflareへQUICで4接続。`/`・`/login`・`/api/health`・`/api/ready`がHTTPS 200 |
| 公開URLへのChromiumでの画面・API・未認証ページ・ログイン画面操作 | 2026-11-06確認済み。`PLAYWRIGHT_BASE_URL=https://mbtracer.yellowtail.work npm run e2e -- home.spec.ts auth.spec.ts --workers=1`で8件成功。実アカウントでの認証は含みません |
| 携帯回線等、ラップトップとは別のネットワークからHTTPSでアクセス | 未確認 |
| HTTPからHTTPSへのリダイレクト、認証レスポンスがキャッシュされない | 2026-11-06確認済み。308でHTTPSへ転送。認証設定APIは`no-store`でキャッシュヒットなし |
| メール／パスワード・Googleの有効化、承認済みドメイン | 未確認 |
| 確認・再設定メールのテンプレート、パスワード条件、メール列挙保護 | 未確認 |
| 新規登録、確認前ログイン拒否、確認メール後のログイン | 未確認 |
| Googleログイン、パスワード再設定と新しいパスワードでのログイン | 未確認 |
| 再読み込み後のログイン維持、ログアウト後の保護ページ拒否 | 未確認 |
| 未認証で`/account`・`/admin`を開くとログインへ遷移 | 2026-11-06確認済み。両方302で`/login`へ遷移し、`/api/auth/me`は401 |
| ログイン開始時の`__Host-mt_login`のSecure・HttpOnly属性 | 2026-11-06確認済み |
| `__Host-mt_session`等のSecure・HttpOnly属性 | 未確認 |
| ホストの公開ポートなし、開発認証・エミュレーター無効 | 2026-11-06確認済み。実Firebase設定で起動し、全サービスにホストの公開ポートなし |
| Windows再起動後の自動復帰、外部ネットワークから再アクセス | 未確認 |
| AC接続時のスリープ・休止・蓋を閉じた時の設定 | 未確認 |
| バックアップ先・頻度・保持期間・暗号化方法 | 未決定 |
| 隔離環境での復元試験、DB・ウォレット・業務記録の照合 | 未確認 |

ログイン状態はFirebaseのメモリー保持ではなくサーバーのHttpOnly Cookieで維持します。動作は[FirebaseのセッションCookie仕様](https://firebase.google.com/docs/auth/admin/manage-cookies)に沿っています。実アカウント・実メール・再起動の確認は、エミュレーターのテストで代用できません。
