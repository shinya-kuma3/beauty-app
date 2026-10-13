# API利用量・料金画面

管理画面の「APIの利用量・料金」は管理者専用です。編集者・Bot・匿名ユーザーはAPIでも閲覧できません。Cloudflare Access JWTと操作時の同一Originを検証します。本番mainへのリリースとは別に、管理WorkerのPreviewへ反映します。

## 表示と集計の範囲

- Cursor Pro: 公式Usage CSVの利用金額・取得できたトークンを年月ごとに集計。契約に含まれる利用／追加利用／種別未分類を分けます。請求書の金額、契約残量、追加課金の有効状態はCSVから推定しません。現在の残量はCursor DashboardのSpendingで確認します。
- Gemini: このWorkerのai_usageから呼び出し回数、取得済み入力・出力トークン、未取得件数を自動集計。失敗した応答の記録も残ります。gemini-3.1-flash-liteの有料単価を幅で換算します。音声・キャッシュの内訳がないため範囲表示です。未取得トークン、他アプリの利用、税、追加機能は含まれません。実請求額ではありません。
- Workers AI: 埋め込みの呼び出し・取得できたトークンを表示。従来の予約量はUTF-8サイズ等から作った予算で、実測トークンやNeuronsへ変換しません。共有無料割当のアカウント残量は未取得です。
- YouTube: channels.list、playlistItems.list、videos.listの試行回数を記録。各1 unitのためこのサイトの試行回数がローカルのクォータ使用量の目安です。失敗した呼び出しも記録します。太平洋時間の日付で集計し、プロジェクト全体の残量は推定しません。
- Turnstile: サーバー検証の試行回数だけを記録。チャレンジ表示回数と区別します。
- Workers、D1、GitHub/Actions: トークン課金と異なるサービスです。請求・利用画面へのリンクと、未接続の状態を表示します。

既存ai_usageは過去分も集計。YouTubeとTurnstileは今回の追加以降のみ。モデルの月はUTC、YouTubeの月はAmerica/Los_Angeles。画面に日付基準を表示します。今日の予算は日本時間09:00にリセットするアプリ独自の上限で、無料枠ではありません。

## Cursor CSVの操作

1. https://cursor.com/dashboard のUsageで、契約期間や表示したい期間を選んでExport CSV。
2. 管理画面でCSVを選び、「以前のCSV集計を置き換える」を確認して取り込む。
3. 表示する年月を選んで更新。

最大1.5MB・10,000データ行・1,000集計グループ。Date（タイムゾーン付きISO日時）、TypeまたはKind、Cost列が必須。ModelとTotal Tokensは任意です。入力・キャッシュ・出力の列一式でもトークンを集計できます。見慣れない種別は未分類、空欄の金額・トークンは未取得件数として残します。異なる形式は拒否し、既存の集計は保持します。原本・ユーザー列・メールは保存しません。

新しいCSVは以前の集計全体を置き換えます。複数期間を足す機能はなく、重複したエクスポートの二重加算を避けます。同一内容のハッシュは再保存しません。データはCSVに含まれた範囲だけであり、月全体・請求期間全体を取得したことにはなりません。

## Cloudflare実請求履歴の自動取得

必要な設定:

- CLOUDFLARE_BILLING_ACCOUNT_ID: 対象アカウントの32桁ID（通常の環境変数）。このサイトのアカウントは519a25f6aeac86ba70ae6c64557ede3d。
- CLOUDFLARE_BILLING_TOKEN: 対象アカウントだけに制限した、Billing Read権限のAPI Token（Worker Secret）。Billing WriteやグローバルAPIキーは不要。

CloudflareのAPI Tokensで対象アカウントのBilling Readを指定してください。値はチャットやGitHubへ貼らず、管理WorkerのPreviewに直接登録します。必要な権限が選べない場合はトークンを広い権限へ変更せず、その画面で確認してください。

設定後、料金パネルを開くと最終試行から15分以上経過した場合に自動取得。ボタンでの再取得は最短1分間隔です。GET /accounts/{account_id}/billing/historyをページごとに最大1,000件取得します。上限に達して全件取れない場合は一部取得と表示。金額・通貨・日付・種別・状態だけ保存します。請求書URL・支払いID・住所・名義は保存しません。失敗時は前回の金額と取得日時を保持し、失敗状態を併記します。通貨を勝手に換算せず、アカウント全体の請求であることを表示します。

これはCloudflareが発行した請求履歴で、今月の未確定使用量のリアルタイム合計ではありません。請求履歴、返金、利用履歴の数字は合算しません。

Geminiのプリペイド残高・取引履歴はGoogle AI StudioのBillingで管理します。Gemini APIキーだけでこれらを取得する公開APIは確認できていないため、実請求が自動取得できるとは表示しません。CSVに例示したCursor金額も実請求と呼びません。

## その他の設定

GEMINI_BILLING_TIERはunknown（既定）／free／paid。AI StudioでAPIプロジェクトのPlanを確認した後だけ設定します。Geminiアプリの有料契約から推測しないでください。表示上の設定で、Googleの契約や料金を変更しません。

既存のAI_DAILY_CALL_LIMIT・AI_DAILY_TOKEN_LIMITが予算メーターの上限です。自動購入、課金有効化、支払情報変更の機能はありません。追加のAI呼び出しでこの画面を生成しません。

## Previewの設定手順

Node22.19以上を使用し、リポジトリ内で:

~~~powershell
node scripts/deploy-preview.mjs --name codex/content-review-pipeline --dry-run
npx wrangler preview secret put CLOUDFLARE_BILLING_TOKEN --name codex/content-review-pipeline --config .wrangler/preview-deploy.local.json --ignore-base-config
~~~

入力を求められたらキーを入力します。表示されないのが正常です。CLOUDFLARE_BILLING_ACCOUNT_IDをwrangler.pipeline.jsoncのpreviews.varsへ設定し、再ビルド後に既存Secretを保持するhelperでデプロイします。ここでは手動のwrangler previewコマンドに切り替えないでください。

追加DB migration: migrations/0008_billing_dashboard.sql（billing_snapshots・api_usageと月次検索用インデックス）。管理Workerより先に対象D1へ適用します。本番DB・mainは変更しません。

## 管理API

- GET /api/admin/billing?month=2026-10: local、cursor、cloudflare、gemini、servicesを返す。未取得はnull。認証済み管理者のみ。
- POST /api/admin/billing/cursor: application/json、{csv: CSV文字列, replace_confirmed: true}。既存集計を置き換え、{unchanged,rows}を返す。
- POST /api/admin/billing/sync: Cloudflare請求履歴を取得。{ok,code}。連携未設定503、短期間の連続実行429。提供元の生エラー・認証情報は返さない。

料金の確認元（2026-10-13）:

- https://cursor.com/help/models-and-usage/usage-limits
- https://cursor.com/help/account-and-billing/overages
- https://forum.cursor.com/t/new-spending-usage-tabs-no-longer-shows-spent/166548/6
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/billing
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.cloudflare.com/turnstile/plans/
- https://developers.cloudflare.com/api/resources/billing/subresources/history/methods/list/
