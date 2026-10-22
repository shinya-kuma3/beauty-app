# 管理画面のページ構成とサイトのアクセス（2026-10-22）

## ページ構成

管理画面は左メニューで切り替える。すべて Cloudflare Access の保護対象（/admin、/admin/*、/api/admin/*）の中にあり、Worker でも Access JWT と管理者・有効な編集者を照合する。

| URL | メニュー | 表示 |
|---|---|---|
| /admin | ダッシュボード | 全員（稼働状況・無料枠は管理者のみ） |
| /admin/articles、/admin/articles/記事ID | 記事 | 全員 |
| /admin/publications | 公開記事の管理 | 全員 |
| /admin/feedback | 意見箱 | 全員（名前・メール・確認済みへの変更・削除は管理者のみ） |
| /admin/ai | 収集・AI処理 | 管理者 |
| /admin/usage | 使用量・料金 | 管理者 |
| /admin/team | 編集者の管理 | 管理者 |

- 1つのHTMLに全ページを持ち、サーバーが開いたURLのページを表示する。メニューの移動は History API で行うため、編集中の記事は移動しても失われない（ブラウザーを閉じる・再読み込みでは確認を表示）。
- 編集者が管理者用のURLを開くと /admin へ302で戻す。メニューにも表示しない。データのAPIは従来どおり管理者専用で拒否する。
- 記事を開くとURLが /admin/articles/記事ID になり、そのURLから直接開ける。
- 意見箱の GET /api/admin/feedback は編集者にも許可し、編集者には id・本文・状態・日時だけを返す（contact:false）。PATCH・DELETE は管理者だけ。

## サイトのアクセス（ダッシュボード）

my-beauty-palette.com のゾーン全体を Cloudflare の GraphQL Analytics API で集計する。公開サイトに計測タグは追加していない。

- 日別：httpRequests1dGroups（閲覧数 pageViews、訪問者数 uniques、リクエスト数 requests）。期間は7・30・90日。日付はUTC（日本時間9時で切り替え）。返ってこなかった日は0にせず「—」として線を途切れさせる。
- 訪問者数は日ごとのユニーク数の目安で、期間の合計は延べ人数。ボットの一部を含む場合がある。
- 記事別（試験中）：httpRequestsAdaptiveGroups を clientRequestPath で集計し、/articles/スラッグ/ と末尾スラッシュなしを合算する。requestSource=eyeball、GET、HTTP 200 に限定。期間は1・3・7・30・90日を選んで取得し、Freeプランで取得できる期間を確認する。取得できない場合は error_code=analytics_query_failed と、管理者にだけ Cloudflare の説明（トークン等を伏せて240文字まで）を返す。
- 取得結果は既存の billing_snapshots に `site-analytics:ゾーンID:種類:日数` で保存し、15分は再利用する。同じ種類・日数の再取得は1分以上あける。新しい migration は不要。

### API

- GET /api/admin/analytics?days=7|30|90
- GET /api/admin/analytics/pages?days=1|3|7|30|90&refresh=1

### 設定

1. Cloudflare の My Profile → API Tokens で既存の `CLOUDFLARE_ANALYTICS_TOKEN` を編集し、Permissions に **Zone → Analytics → Read** を追加する。Zone Resources は my-beauty-palette.com だけに限定する。既存の Account Analytics Read・D1 Read はそのまま残す。トークンの値は変わらない。
2. Cloudflare で my-beauty-palette.com の概要ページ右下にある「ゾーンID」（32文字）を確認し、wrangler.pipeline.jsonc の previews.vars に `CLOUDFLARE_ANALYTICS_ZONE_ID` として追加する。ゾーンIDは秘密情報ではない。
3. `npm run deploy:preview -- --name codex/content-review-pipeline` で管理用 Preview を更新する。
4. ダッシュボードを開き、グラフが表示されるか確認する。続けて「記事ごとの閲覧数」で1日〜90日を順に取得し、取得できた最長の期間を記録する。

参照：https://developers.cloudflare.com/analytics/graphql-api/
