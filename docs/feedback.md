# 意見箱とヒーローの運用

公開側はAstroの静的ページです。/feedback/ は管理Workerの /api/feedback へJSONを送信します。管理画面の「意見箱」は管理者だけに表示されます。編集者・Grok Bot・匿名ユーザーは投稿一覧を取得できません。

## Cloudflare

- migrations/0006_feedback.sql を管理WorkerのD1へ適用。
- TURNSTILE_SITE_KEY：公開可能なWidgetのサイトキー（Preview varsに設定済み）。
- TURNSTILE_SECRET_KEY：Worker PreviewのSecret。値はリポジトリに入れません。
- Widgetの許可ホストに本番・Preview・ローカルを設定。actionはfeedback。
- 管理用Previewを更新する際は npm run deploy:preview を使い、既存のSecretを引き継ぎます。
- 独立した本番管理Workerに移す場合は、src/pages/feedback.astro の公開API URL、worker/feedback.mjs の許可Origin、Widget許可ホストも更新してください。

## API

GET /api/feedback/config → {enabled,sitekey}（秘密情報なし）。
POST /api/feedback → {id:UUID,name?:string,email?:string,message:string,token:string,company_website?:string}。本文1～5000文字、名前80文字、メール254文字。成功201 {ok:true}。JSONと許可Originが必須。

Turnstileをサーバーで検証し、hostnameとactionも照合します。IPは保存せず、秘密キーでソルトしたSHA-256を短期の回数制限に使用。1IPにつき15分3回・1日10回、全体で1時間200回。超過429。無効な確認は400、検証サービス停止時は503で保存しません。同じUUID・同じ本文の再送は重複保存しません。

管理者限定：GET /api/admin/feedback?status=new|read|all&limit=30&offset=0、PATCH /api/admin/feedback/:id {status:new|read}、DELETE /api/admin/feedback/:id。Access認証と更新時の同一Origin照合が必要。削除で名前・メール・本文を消去します。AI送信・自動返信・公開はしません。

## 表示とライセンス

ヒーローは8秒ごとに5場面を切り替え、ホバー・フォーカス・非表示タブで停止。手動切り替えと停止ボタンあり。動きを減らす設定では自動切り替えなし。

ライブラリ更新後は npm run licenses:generate で public/third-party-licenses.txt を更新してください。全文転載・再配布は意見箱から事前相談。これによってサイト全体やコードにOSSライセンスを付与するものではありません。
