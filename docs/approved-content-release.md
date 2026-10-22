# 承認済み記事のGit同期と本番公開

## 実行の流れ

1. 編集者が管理画面で確認・保存・公開承認します。未承認の記事は対象外です。
2. GitHub Actions「Approved article publication」が15分ごと（混雑時は遅延あり）または手動で実行されます。承認済み記事を `src/content/approved-articles/*.json` としてdevelopへcommitします。
3. Actionsが管理Workerへ、本番mainの旧記事と新しい承認記事の差分確認を依頼します。
4. Grok Botが `/api/ingest/releases` から依頼を取得し、人が承認した記事とGitの固定記事を照合して結果を返します。科学的根拠による再審査は行いません。
5. 全記事がmatch、verdictがpass、警告なしの結果だけを許可します。不明・相違・警告・古い内容の結果は止めます。
6. Actionsが本番mainのコードを使って型チェック、テスト、静的ビルド、生成本文と出典の照合、メンズのビルドを行います。
7. 内容のハッシュとブランチの版を再確認し、記事JSONだけをmainへcommit・pushします。GitHubの更新はforce=falseです。コード・Workflow・設定などは自動取り込みしません。
8. main用のCloudflare Deploy Hookを呼び、Gitの固定記事から静的HTMLを配信します。管理Workerは本番のmanifestを見て反映済みを判定します。

Grok BotにはGitHubへの書き込み権限や本番公開のAPIキーを渡しません。Grokは確認結果だけを返します。人の承認なしに記事を公開する経路はありません。

## Cloudflareの構成

- `wrangler.jsonc`：本体の静的アセット専用Worker、beauty-app。mainとdevelopの通常ビルドで使用します。D1、AI、実行スクリプトはありません。`preview_urls: true`でdevelopと管理用Previewのworkers.dev URLを維持します。
- `wrangler.mens.jsonc`：メンズの静的サイト、beauty-app-mens。共通記事は本体へリンクします。
- `wrangler.pipeline.jsonc`：D1・Access・AI・収集APIを持つ管理Workerの設定。既存のcodex/content-review-pipeline Previewを継続利用します。
- 管理画面・Bot/API： https://codex-content-review-pipeline-beauty-app.sinyak4649.workers.dev/
- 本体： https://my-beauty-palette.com/
- メンズ： https://mens.my-beauty-palette.com/

Cloudflare BuildsはProduction branch=main、Tracking branch=develop、Build command=`npm run build`、Deploy command=`npx wrangler deploy`、Preview command=`npx wrangler preview`です。rootの設定が静的配信専用なので、本番へ管理APIを展開しません。管理Workerの手動更新は `npm run deploy:preview -- --name codex/content-review-pipeline` を使い、既存シークレットを保持します。

本番のビルドはDBを取得しません。WORKERS_CI_BRANCH=mainではCONTENT_PIPELINE_ENABLED=trueが残っていてもGitの固定記事だけを使います。管理用Previewの明示的なliveビルドは引き続き利用できます。記事の自動公開とは別に管理Workerを変更した場合は、上記コマンドで再デプロイします。

## 必要な設定

### GitHub → Settings → Secrets and variables → Actions

| Secret                            | 内容                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| RELEASE_API_KEY                   | 管理Workerの同名Secretと同じ値。記事同期と公開状態の記録だけに使用 |
| CLOUDFLARE_PRODUCTION_DEPLOY_HOOK | beauty-appのmain用Deploy HookのURL                                 |

GITHUB_TOKENはActionsが自動発行します。個人用PATは不要です。Workflowはcontents:writeを明示し、書き込み処理を記事ファイルに限定します。main/developの保護ルールでActionsの更新が禁止されている場合は、そのルールに従って処理が失敗します。保護を回避するforce pushは行いません。

任意のRepository Variable CONTENT_RELEASE_API_URLは管理WorkerのHTTPSルートURLです。未設定時は上記の現在の管理Workerを使います。

### 管理Worker

`RELEASE_API_KEY`を追加します。Grokは引き続きINGEST_API_KEYを使います。CONTENT_DELIVERY_MODE=githubは管理Previewの設定に記載済みです。公開承認から同期までの状態をpublication_jobsへ記録します。

migration 0005_content_releases.sqlは、Grokの本番審査結果・mainのSHA・build IDを保存します。公開済みの記事は直接編集せず、改訂を作成して再承認します。旧版は改訂中もmainの固定ファイルとして公開を維持します。

## API

RELEASE_API_KEYをBearerで使用（Actions専用）：

| Endpoint                                 | 内容                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| GET /api/release/articles?cursor=...     | 人が承認した記事の固定JSON・SHA-256・改訂番号。ページ50件          |
| POST /api/release/requests               | main_base_sha、develop_sha、changes（最大5件）から確認依頼を登録   |
| GET /api/release/requests/:id            | 確認待ち／合格／拒否／古い結果／Git反映済みとハッシュ              |
| GET /api/release/reconcile               | mainのpush後に通信が失敗した確認の再照合用                         |
| POST /api/release/requests/:id/published | Grok合格済みの変更のmain SHAを記録。記事の公開承認自体は変更しない |
| GET /api/release/builds                  | mainへ反映済みでHook未完了のものを取得                             |
| POST /api/release/requests/:id/build     | main SHAとCloudflare build UUIDを記録                              |

INGEST_API_KEYをBearerで使用（Grok Bot専用）：

- GET /api/ingest/releases：未処理の差分審査を最大3件取得。各依頼は最大5記事です。
- POST /api/ingest/releases/:id/result：digest、verdict、checks、findings、summaryを返します。

```json
{
  "digest": "GETで受け取った64桁のdigest",
  "verdict": "pass",
  "checks": [
    {
      "article_id": "対象記事のUUID",
      "verdict": "match",
      "notes": "承認本文、Gitの内容、出典を確認した結果"
    }
  ],
  "findings": [],
  "summary": "相違と警告を確認した結果"
}
```

checksは対象記事のすべてについて1件ずつ必要です。各verdictはmatch / mismatch / uncertain。findingsはarticle_id、severity（warning / notice）、reasonを指定します。全件matchでwarningがない場合だけpassを返せます。確認できなければblockを返してください。事実を調べず機械的にpassにしないでください。

```bash
curl "$BEAUTY_API_URL/api/ingest/releases" \
  -H "Authorization: Bearer $INGEST_API_KEY"

curl -X POST "$BEAUTY_API_URL/api/ingest/releases/依頼ID/result" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @release-result.json
```

公開・Git操作のためのキーをGrokへ渡す必要はありません。AIの確認内容も版に結びつけて記録し、素材や承認記事が変われば古い合格は無効になります。

## 手動実行と障害時

GitHub → Actions → Approved article publication → Run workflow。mainから実行してください。

Grok待ちではwaiting_grok、指摘ありはblockedと表示し、mainを変更しません。記事を修正する場合は管理画面の「公開記事の改訂を作成」から行います。再び人が公開承認すると、新しい版についてGrokへ依頼します。同じ版を再確認する場合は管理者が公開反映の再試行を実行します。

差分同期は1回最大20件、本番確認は最大5記事です。mainへのpush後にHookが失敗した場合も、次回に未完了のビルドを再試行します。承認済み記事の削除や、記事以外のコード変更の本番公開は自動では行いません。

参考：[GitHubのWorkflow実行条件](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Cloudflare Deploy Hooks](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)。GitHub_TOKENによるpushは他のActionsのpushイベントを発火させないため、このWorkflow内で必要な検証と本番Hookを明示的に実行します。

## 公開ワークフローの即時呼び出し（2026-10-23）

GitHub の定期実行（15分ごと）は混雑時に数時間遅れることがあるため、管理Worker が次の操作の直後に「Approved article publication」（content-release.yml、ref=main）を workflow_dispatch で呼び出す。定期実行は取りこぼし時の保険として残す。

- 編集者・管理者が記事の公開を承認したとき（reason=approved）
- Grok の本番差分確認が pass で、依頼が approved になったとき（grok_passed）
- 公開記事の非公開を依頼したとき（withdrawal）
- 管理者が公開反映を再試行したとき（retry）

呼び出しは CONTENT_DELIVERY_MODE=github で、次の設定がそろっている場合だけ行う。応答の後に実行し（waitUntil）、失敗しても承認などの操作は取り消さない。失敗時はログに publication_dispatch_failed と原因コードだけを出す。

- GITHUB_DISPATCH_REPOSITORY（変数）：`shinya-kuma3/beauty-app`
- GITHUB_DISPATCH_APP_ID（変数）：自動公開用 GitHub App の App ID
- GITHUB_DISPATCH_PRIVATE_KEY（シークレット）：同じ App の秘密鍵（PKCS#1 の .pem のまま可）。GitHub Actions 用とは別に、App で新しい鍵を発行して登録する。

App には Repository permissions の「Actions: Read and write」を追加する（Contents: Read and write は自動公開のため維持）。権限の追加後、App のインストール画面で新しい権限を承認する。Worker は App の JWT（RS256、有効10分）でインストールトークンを取り、`actions: write` だけに絞って対象リポジトリのワークフローを呼び出す。
