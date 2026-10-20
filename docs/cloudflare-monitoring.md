# Cloudflareの稼働状況・無料枠

管理画面 /admin の「サイトの稼働状況・無料枠」で確認します。管理者専用で、編集者やGrok Botは取得できません。mainは変更せずdevelopと管理用Previewで検証します。

## 表示する内容

- アカウント全体のWorker実行回数・実行エラー・エラー率、Worker名と実行状態別の内訳、今日の時間帯別推移。
- アカウント全体のD1読み込み・書き込み行数、DB別のクエリ回数・P90処理時間・現在容量。
- Workers Freeの残量と使用率。80%以上で注意、100%以上で上限表示。超過分を負の残量として表示しません。
- 管理Workerで返したHTTP 5xxは別に日次記録します。この実装の追加後・現在のDB環境だけの値です。DBの停止・枯渇、Worker自体が起動しない場合は記録できません。

日次期間はUTC 00:00から取得時点まで、日本時間09:00にリセットします。画面の日時は日本時間です。容量には日次リセットがありません。

静的ファイルを直接配信する閲覧はWorker実行枠に含みません。Analyticsは遅延・サンプリングを含み、残量は取得時点の目安でありリアルタイムの厳密なカウンターではありません。同時接続人数やDBのCPU使用率ではありません。アカウント全体の枠なので他プロジェクトも含みます。

## 最初の設定

1. CloudflareのMy Profile → API Tokens → Create Token → Custom tokenを開きます。
2. Permissionsに Account → Account Analytics → Read と Account → D1 → Read を指定し、Account Resourcesはbeauty-appを配置したアカウントだけに限定します。Write権限・Global API Keyは不要です。
3. 作成したトークンを管理用Preview codex/content-review-pipelineのVariables and Secretsで種類Secret、名前CLOUDFLARE_ANALYTICS_TOKENとして保存します。チャットやGitHubのコードに貼り付けません。請求用のCLOUDFLARE_BILLING_TOKENとは別です。
4. 管理画面を開き直し、稼働状況パネルで「最新の利用状況を取得」を押します。

CLIで登録する場合、beauty-appのディレクトリで、既存シークレットを保持する設定ファイルを作ってから実行します。

~~~powershell
node scripts/deploy-preview.mjs --name codex/content-review-pipeline --dry-run
npx wrangler preview secret put CLOUDFLARE_ANALYTICS_TOKEN --name codex/content-review-pipeline --config .wrangler/preview-deploy.local.json --ignore-base-config
~~~

入力はWranglerの対話欄に貼り付けます。.wrangler配下の生成ファイルはGit管理対象外です。その後のデプロイでも既存のシークレットは保持します。

## 設定値

- CLOUDFLARE_MONITOR_ACCOUNT_ID: 任意。未指定なら既存CLOUDFLARE_BILLING_ACCOUNT_IDを使います。
- CLOUDFLARE_WORKERS_PLAN: free / paid / unknown。今回ユーザーがFreeを確認したためPreviewはfreeに設定済み。契約を変更したら更新してください。Paid/unknownではFreeとの参考比較と明記し、現在契約の残量とは扱いません。
- CLOUDFLARE_MONITOR_DATABASE_ID: 管理用DBを内訳で区別するID。アカウント全体の集計にはフィルターをかけません。
- CLOUDFLARE_ANALYTICS_TOKEN: 上記のWorker Secret。

無料枠の確認日2026-10-20: Worker実行100,000回/日、D1読み込み5,000,000行/日、書き込み100,000行/日、アカウント容量5 GB、1 DB 500 MB。容量は10進単位で表示。定義はworker/health.mjsのfreeLimitsです。

## API・保存・取得制限

- GET /api/admin/health: 最後の集計を返します。5分以上経過していれば自動取得。未連携はconfigured:falseで数値・残量はnullです。
- POST /api/admin/health/sync: 同一Originの認証済み管理者だけが明示取得。最短1分間隔。未設定503、短時間の連続実行429。部分失敗は200でok:false、各segmentsにerror_codeを返します。

既存billing_snapshotsにアカウント別キーで集計のみ保存し、新しいmigrationは不要です。Worker/D1処理/容量は独立して取得し、失敗部分は前回値・取得日時・失敗状態を保持します。前日の実行・行数は今日の残量計算に流用しません。取得できない数値を0として扱いません。

APIトークンはサーバーだけで使用します。ブラウザーに送るものは集計値と設定済みかどうかだけです。SQL本文、メール、IP、リクエスト本文、スタックトレース、生の提供元エラーは保存しません。HTTP 5xxだけ既存api_usageへ1エラー1行の加算を行い、成功リクエストごとの書き込みは行いません。

Worker・D1の内訳は最大1000グループ、時間帯は最大24グループ。上限に到達した内訳は一部取得と表示し、全体枠は独立したグループなしの集計を使います。容量はDB一覧の最初100件のうち最大20件の詳細を取得し、一覧・詳細が全部取得できない場合は全体容量の残量を計算しません。FreeのDB数上限10件をカバーします。過度な監視処理を避けるための制限です。

D1の無料枠が尽きるとこの管理画面も利用できない場合があります。Cloudflareの公式画面へのリンクと、Cloudflare側の使用量通知も併用してください。今回の機能にメール通知や自動アップグレードはありません。

## 参照した公式仕様

- https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
- https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/observability/metrics-analytics/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/
