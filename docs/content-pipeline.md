# 収集・AI処理・審査・公開

## 構成と変更したファイル

公開サイトは既存のAstroの静的生成を維持する。既存記事のJSONは残し、D1で承認された追加記事だけをビルド時に読み込む。

| ファイル | 役割 |
| --- | --- |
| `worker/index.ts` | HonoのAPI、Bearer認証、Access JWT検証、管理者の審査、Cron入口 |
| `worker/core.mjs` | 入力検証、URL・SHA-256、コサイン類似度、安全なMarkdown表示 |
| `worker/config.mjs` | タグの説明文、モデル、しきい値、入力・出力・日次上限 |
| `worker/ai.mjs` | 要約、埋め込み、キャッシュ、同時実行の制御、利用量、処理待ち |
| `worker/youtube.mjs` | 投稿一覧と動画IDの取得、通常動画・Shortsの素材登録 |
| `worker/publish.mjs` | 再ビルドの起動と、配信中の公開記事の版の確認 |
| `worker/admin.mjs`・`public/admin-dashboard.*` | `/admin`の管理画面 |
| `migrations/0001_content_pipeline.sql` | 素材、記事、関連、審査履歴、AI結果、チャンネル、公開処理のテーブル |
| `scripts/export-content.mjs`・`scripts/site-command.mjs` | 承認された記事をAstro向けに取り込み、公開ページ・一覧・検索を生成 |
| `src/content.config.ts`・`src/pages/articles/[id].astro`・`src/components/Sources.astro` | 追加記事の読み込み、本文、出典、AI補助の表示 |
| `scripts/setup-cloudflare.mjs`・`scripts/sample-ai.mjs` | テストDB設定と、実際のAIを試す記事の登録 |
| `tests/pipeline.test.mjs` | 実SQLiteとAI応答の代替を使ったAPI・認証・公開制御の結合テスト |

Grok Botは外部のアシスタントで、収集・信頼性の確認・記事化を担当する。このWorker自身はGrokを定期起動しない。BotのHTTP呼び出し・定期実行はBot側で設定する。BotにGitHubへの公開権限は不要。

## 管理者とBotの権限

- Botは素材の登録・取得と記事の提出だけを行う。記事提出はDB内で `draft → pending_review` と進める。
- `pending_review → published / rejected` は管理者APIだけで行う。DBにも遷移制限を置く。
- 管理者は本文、出典、信頼性メモ、元の素材、AIの提案を確認して審査する。AI処理未完了の記事は公開できない。
- 公開時は管理者の本人情報、日時、記事の版を記録する。公開済み・却下済み記事は変更できない。訂正は新しい下書きとして提出する。
- 管理画面のリンクを隠すだけではなく、`/admin`と`/api/admin/*`をAccessとWorkerの署名・issuer・audience・管理者メール確認で守る。設定不足なら403で閉じる。
- 管理者の更新では同一Originと最新revisionを要求する。公開用のexportに素材、信頼性メモ、管理者メールは含めない。
- 医療・効果の断定に見える表現と原文確認の必要性を確認メモ・画面に表示する。これは事実確認の代わりではない。公開にはX・YouTube以外の資料も必要。

## テスト環境の設定順序

2026-10-08現在、テストD1 `beauty-content-test`（`c2466b2d-e802-47e7-8f7a-9e75aa9aa36c`）へのマイグレーションは適用済み。DBを作り直す必要はない。

作業ブランチの固定Preview URL：
[作業ブランチのテストサイト](https://codex-content-review-pipeline-beauty-app.sinyak4649.workers.dev/)

本体・メンズの表示、developmentのD1接続、未認証アクセスの拒否をリモートで確認済み。これは `codex/content-review-pipeline` 用で、developへの統合はまだ行っていない。

`INGEST_API_KEY` と `CONTENT_EXPORT_KEY` は別々のランダム値を生成し、このPreviewへ登録済み。値はGit対象外の `.dev.vars`、Preview URLはGit対象外の `.env` に保存している。この2つのキーの再生成・再登録は不要。

次は手順3の `GEMINI_API_KEY`・`YOUTUBE_API_KEY`、手順4のAccess、手順5の再ビルド設定を行う。実AI・管理者ログイン・公開反映は未検証。秘密の値をGitHubやチャットに貼らない。

現在のPreviewへGoogleのキーを登録するコマンド：

```powershell
npx wrangler preview secret put GEMINI_API_KEY --name "codex/content-review-pipeline"
npx wrangler preview secret put YOUTUBE_API_KEY --name "codex/content-review-pipeline"
```

[Geminiのキー作成手順](https://ai.google.dev/gemini-api/docs/api-key)、[YouTube Data APIの設定手順](https://developers.google.com/youtube/v3/getting-started)を参照する。YouTubeではData API v3を有効にし、YouTube専用のAPIキーを作成する。以下は新しい環境を準備する場合も含む一般的な設定手順。

### 1. Cloudflareにログインし、テストDBを作る

プロジェクトのフォルダで実行する。Node.js 24を推奨。

```powershell
npx wrangler login
npx wrangler d1 create beauty-content-test
npm run setup:cloudflare -- --test-id 表示されたdatabase_id
```

最後のコマンドが `wrangler.jsonc` の `previews.d1_databases` を更新し、テストDBだけにマイグレーションを適用する。既存DBがある場合はCloudflareのD1画面で名前とIDを確認して再利用する。更新した `wrangler.jsonc` はコミット対象。補助の `wrangler.test.local.json` はGit対象外。

本番DBのIDは初期状態では未設定のゼロUUID。本番へのリリース前に別の `beauty-content-production` を作成し、トップレベルのIDを設定する。テストDBと同じIDは使わない。

### 2. 作業ブランチのPreviewを作成する

```powershell
npm run build
npx wrangler preview
```

表示されたPreview URLを控える。管理画面はまだ403で正常。最初は公開記事の取り込みを無効にしているので、既存の静的サイトをビルドできる。

Workers Buildsでは本番ブランチをmain、統合テストをdevelopにする。Build commandは `npm run build`、Preview commandは `npx wrangler preview`。developへの統合後も同じテストDBを使えるが、Preview固有のシークレットとAccess対象ホストは別途設定・確認する。

### 3. Previewのシークレットを設定する

```powershell
npx wrangler preview secret put INGEST_API_KEY
npx wrangler preview secret put GEMINI_API_KEY
npx wrangler preview secret put YOUTUBE_API_KEY
npx wrangler preview secret put CONTENT_EXPORT_KEY
```

現在の作業ブランチのPreviewへ登録する。developのPreviewに登録する場合は末尾に `--name develop` を付ける。キーは入力プロンプトへ入力する。

| 名前 | 入手・用途 |
| --- | --- |
| `INGEST_API_KEY` | ランダムな32バイト以上の値を生成し、Grok BotとWorkerだけで共有 |
| `GEMINI_API_KEY` | Google AI Studioで作成。無料枠のプロジェクトで始める |
| `YOUTUBE_API_KEY` | Google CloudでYouTube Data API v3を有効にし、用途をこのAPIに制限したキーを作成 |
| `CONTENT_EXPORT_KEY` | INGESTとは別のランダム値。Workerとビルド処理だけで共有 |
| `CONTENT_DEPLOY_HOOK` | 公開後の再ビルドを起動するURL。後の手順で登録 |

32バイトの値の生成例（表示された値はリポジトリに書かない）：

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Workers AIは `AI` bindingを使い、別のAPIキーをコードへ入れる必要はない。無料枠はアカウント全体で共有される。テストと本番のアプリ内上限を分けても、Cloudflare側の無料枠が増えるわけではない。

### 4. 管理者認証を設定する

Cloudflare Zero Trust → Access → ApplicationsでSelf-hostedアプリを設定する。

- 管理対象：Previewのホストの `/admin` と `/admin/*`、`/api/admin/*`。ひとつのAccessアプリの同じAUDで扱う。
- Allowポリシー：管理者本人のメールだけを許可する。ワンタイムメールコード等でログインする。
- Botの `/api/ingest/*` とビルド用の `/api/published/export` はこのログイン保護に含めない。それぞれ別のBearer認証で保護する。
- `workers.dev` のPreview全体をAccessで保護している場合、Botとビルドの認証も必要になる。ホスト名・パス単位のSelf-hostedアプリへ切り替える。workers.devでもホスト名・パスを対象にできる。Worker内部の管理者検証は残す。

Access画面の情報を、Previewのシークレットとして設定する。

```powershell
npx wrangler preview secret put ACCESS_TEAM_DOMAIN
npx wrangler preview secret put ACCESS_AUD
npx wrangler preview secret put ADMIN_EMAILS
```

`ACCESS_TEAM_DOMAIN` は `https://チーム名.cloudflareaccess.com`、`ACCESS_AUD` はアプリのApplication Audience、`ADMIN_EMAILS` は許可するメール（複数ならカンマ区切り）。同じPreviewを再ビルドした後にも設定が残り、ログインできることを確認する。

### 5. 承認後の再ビルドを設定する

Workers & Pages → beauty-app → Settings → Builds → Deploy Hooksで、確認中のブランチ用のHookを作成する。作業ブランチで試すときはそのブランチを選び、developへ統合後はdevelop用に切り替える。本番用Hookは共有しない。

```powershell
npx wrangler preview secret put CONTENT_DEPLOY_HOOK
```

Workers Buildsの確認中ブランチ用のビルド環境へ、次の値を追加する。公開側にキーを渡さないので `PUBLIC_` は付けない。

| ビルド設定 | 値 |
| --- | --- |
| `CONTENT_PIPELINE_ENABLED` | `true` |
| `CONTENT_API_URL` | その環境の最新Previewを指すURL（固定された過去デプロイURLを使わない） |
| `CONTENT_EXPORT_KEY` | 手順3でWorkerに入れた同じキー。ビルド用Secretとして設定 |
| `CONTENT_ENV` | `development` |

本番ビルドとPreviewビルドで値を分ける。`WORKERS_CI_BRANCH` がmain以外なら、取り込むデータがdevelopmentであることを検証する。認証・取得・環境判定に失敗した場合はビルドを止め、空のサイトで置き換えない。

公開操作は承認済み状態と公開処理をDBに保存し、Hookを起動する。Hookの成功だけでは「反映済み」にしない。配信中の `content-manifest.json` に承認した記事のIDと版が含まれることを確認して反映済みにする。管理画面の「更新する」で確認する。ビルドが失敗した場合はCloudflareのBuild historyで原因を確認し、「公開反映を再試行」で再起動できる。

## AIとチャンネルの設定

| Worker変数 | 初期値 |
| --- | --- |
| `EMBEDDING_MODEL` | `@cf/baai/bge-m3`（1024次元の多言語モデル） |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` |
| `FALLBACK_MODEL` | `@cf/qwen/qwen3-30b-a3b-fp8`（日本語対応、MoEの稼働部分が約3B） |
| `SUMMARY_PROVIDER` | `auto`（gemini / workersも指定可能） |
| `TAG_THRESHOLD` | `0.55`。数件の実AI結果を管理者が確認して調整 |
| `SUMMARY_INPUT_CHARS` | `3000`（タイトル・見出しも含む全入力の上限） |
| `EMBEDDING_INPUT_CHARS` | `1200` |
| `SUMMARY_MAX_TOKENS` | `512` |
| `VIDEO_MAX_TOKENS` | `1536`（詳細情報を含むため文章とは別） |
| `AI_DAILY_CALL_LIMIT` | `30`（失敗・再試行・埋め込みも含む） |
| `AI_DAILY_TOKEN_LIMIT` | `600000`（保守的に予約するトークン上限） |
| `YOUTUBE_VIDEOS_PER_RUN` | `3` |
| `YOUTUBE_MAX_SECONDS` | `1800`（長い動画は記録して処理をスキップ） |
| `JOBS_PER_RUN` | `1`（無料枠のDB呼び出し上限に合わせ、1実行1件） |
| `INGEST_REQUESTS_PER_MINUTE` | `60`（共有DBで制限） |
| `ENABLE_SCHEDULED` | `false`（初期状態では自動収集しない） |

BGE-M3は日本語を含む多言語の比較に使えるため採用し、タグ分類で生成モデルを呼ばない。Gemini Flash-Liteは低コストの要約と動画入力をまとめて扱うため採用した。代替のQwenは日本語の文章要約に使い、短い出力と非思考モードの指示で消費を抑える。

日次上限はUTCの日付で管理し、日本時間09:00に次の日へ切り替わる。入力のUTF-8バイト数を文章トークンの保守的な上限として予約する。動画は時間から別途多めに予約する。APIが返す使用量は別に記録し、予約量と実測値を混同しない。埋め込みや失敗応答で使用量が返らない場合は推定扱い。再試行の予約量を返却しないため、上限を守る側に倒す。

既存の短い記事では入力と指示文で数百〜1000トークン程度、出力は数百トークンが目安。日本語3000字の入力や動画の消費はより大きくなる。これらは概算で、実測値は管理画面に表示する。外部Grok Botの利用量はこのWorkerの集計に含まれない。

タグ一覧と説明は `worker/config.mjs`。AIタグは最大5個、類似度が足りなければ0個を許容する。タグの変更は変更された説明だけをまとめて埋め込み、記事のベクトルは再利用する。AIのタグと要約を管理者が編集できる。本文変更後は再処理を待ってから審査する。

キャッシュのキーには入力・モデル・要約指示の版を含める。DBの処理待ちとキャッシュの両方に同時実行制御を置く。応答のJSON・文字数・要点数の検証に失敗した場合は1回だけ再試行する。通信結果が不明な場合や通常の失敗は無限に再送せず、管理画面から明示的に再試行する。

EGA.channelを初期登録し、通常動画もShortsも扱う。最初は新しい動画から最大3本を対象とし、その後は投稿日時の記録から新着を取得する。最新20件の一覧を確認し、1回あたり最大3チャンネル・12件の動画を調べる。監視先が増えた場合は前回確認が古いチャンネルから順番に進める。動画IDは一意で、処理に失敗しても重複素材を作らない。動画の詳細と短い要約は1回の生成で取得し、同じ動画要約をもう一度要約しない。動画から取れた体験談は研究上の根拠として断定しない。

文章はGemini制限時にWorkers AIへ切り替える。動画は文章用モデルで読めないのでGemini再開まで延期する。この実装は第三者動画の字幕ダウンロードを行わない。公開動画URLの直接入力を使う。

将来の自動チャンネル追加に備え、channelsにcandidate / approved / rejectedを用意した。今回は管理画面で追加・停止できるところまで実装。AIによる候補発見と自動追加の判断は今後の機能。

## Cronと本番リリース

Workers PreviewはCronの実行対象にならない。テストは `/admin` の「動画を探す」「AI処理を進める」を使う。D1の処理待ちを順番に扱うのでCloudflare Queuesは初期実装では不要。

本番へのリリースを明示的に承認した後に、別の本番D1・Access・キー・Hook・ビルド環境を設定する。本番D1のIDをトップレベルへ入れ、`npx wrangler d1 migrations apply beauty-content-production --remote` でマイグレーションを適用する。`ENABLE_SCHEDULED=true` にするとCron `0 0 * * *`（日本時間09:00）で新着収集が動く。AI処理は `15 * * * *`（毎時15分）で1件ずつ進める。mainへの反映は今回行わない。

## API仕様とGrok Botの手順

すべてHTTPS、JSON。Botは `Authorization: Bearer <INGEST_API_KEY>` を送る。レスポンスのエラーは `{ "error": { "code": "..." } }`。認証401、入力400、重複や競合409、回数制限429。キーやAPI応答中の秘密はログへ出さない。

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/ingest/health` | 認証済みBotが環境名を確認 |
| `GET /api/ingest/sources?status=new&offset=0` | 素材を最大50件。`next_offset` がnullになるまで取得 |
| `POST /api/ingest/sources` | X・海外記事を保存。youtubeは収集処理だけが登録 |
| `POST /api/ingest/articles` | 素材ID、出典URL、信頼性メモ付きで審査待ちへ提出 |
| `PATCH /api/ingest/sources/:id` | newの素材をused / rejectedへ |
| `GET /api/admin/articles?status=pending_review` | 管理者向け一覧（ページ送り対応） |
| `GET /api/admin/articles/:id` | 本文プレビュー、素材、メモ、履歴、公開への反映 |
| `PATCH /api/admin/articles/:id` | 最新revision付きで審査待ち記事を編集 |
| `POST /api/admin/articles/:id/review` | `status`・`revision`・`confirmed:true` で審査 |
| `POST /api/admin/articles/:id/retry-build` | 公開への反映を再試行 |
| `POST /api/admin/jobs/run` | AI処理を進める |
| `POST /api/admin/jobs/:id/retry` | 失敗した処理の明示的な再試行 |
| `POST /api/admin/youtube/discover` | 新着動画を取得 |
| `GET /api/admin/operations` | 利用量、素材、処理待ち、チャンネル、設定 |
| `POST /api/admin/channels`・`PATCH /api/admin/channels/:id` | チャンネルの追加・有効/無効 |
| `GET /api/published/export` | ビルド専用。別Bearerキーと環境名を要求し、承認済み記事だけ返す |

Grok Bot側で `BEAUTY_API_URL` と `INGEST_API_KEY` を秘密の環境変数として設定する。以下はbash/curl例。Windowsでは `curl.exe` と入力JSONファイルを使える。

素材のリクエストを `source.json` に用意する：

```json
{"type":"research","source_url":"https://example.org/study","author":"著者名","title":"ケア情報の素材","raw_summary":"原文を確認して得た要点。主張の根拠と限界も記載する。","language":"en"}
```

```bash
curl -X POST "$BEAUTY_API_URL/api/ingest/sources" \
  -H "Authorization: Bearer $INGEST_API_KEY" -H "Content-Type: application/json" \
  --data-binary @source.json
curl "$BEAUTY_API_URL/api/ingest/sources?status=new" \
  -H "Authorization: Bearer $INGEST_API_KEY"
```

登録の応答は `{"id":"素材UUID","status":"new","ai_status":"queued"}`。YouTubeは要約が完成した素材だけが取得一覧に出る。

記事を `article.json` に用意する。素材UUIDと出典は実際のものに置き換える。公開済みの既存記事と同じslugは使えない。

```json
{
  "slug":"new-care-note",
  "title":"ケアを考えるための情報",
  "body_markdown":"## 内容\nケアを選ぶ際の参考情報を整理した記事です。紹介されている主張の根拠と限界を確認し、効果や医療的な判断を断定せず、管理者が出典の原文まで確認するための下書きです。",
  "excerpt":"内容と出典を確認するためのケア記事です。",
  "category":"skin",
  "tags":[],
  "source_ids":["取得した素材UUID"],
  "citations":["https://example.org/study"],
  "ai_check_notes":"根拠の強さ、対象、限界、未確認の主張を記載。管理者の原文確認が必要。"
}
```

```bash
curl -X POST "$BEAUTY_API_URL/api/ingest/articles" \
  -H "Authorization: Bearer $INGEST_API_KEY" -H "Content-Type: application/json" \
  --data-binary @article.json
curl -X PATCH "$BEAUTY_API_URL/api/ingest/sources/素材UUID" \
  -H "Authorization: Bearer $INGEST_API_KEY" -H "Content-Type: application/json" \
  --data '{"status":"used"}'
```

記事の応答は `{"id":"記事UUID","status":"pending_review","ai_status":"queued"}`。`published`を指定する入力は受け付けない。Botのtagsは仮の入力で、実際のAI分類は埋め込み処理が行う。管理者が変更したタグ・紹介文はAIが上書きしない。

## 実際のAIで数件を試す

`.env` に `CONTENT_API_URL`、ローカルの `.dev.vars` に同じテスト用 `INGEST_API_KEY` を設定する（両ファイルはGit対象外）。

```powershell
npm run sample:ai
```

保湿・ヘアケア・爪ケアの既存記事を素材にした3件を、審査待ちのテスト記事として登録する。テスト環境以外では実行できず、同じテストslugを再登録しない。管理画面でAI処理を進めると、実際のタグ、200字以内の要約、最大3つの要点、モデルと利用量を確認できる。テスト記事は公開せず、確認後に却下する。

ローカルの結合テストではAI応答を差し替えているため、そのタグ・要約は本物のAIの品質評価には使えない。実APIのキーとD1・Accessの設定後にこの手順で実測する。

参考：[BGE-M3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)、[Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)、[Qwen](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)、[WorkersのAccess設定](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)、[Preview設定](https://developers.cloudflare.com/workers/previews/configuration/)、[Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Deploy Hooks](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)、[Gemini動画入力](https://ai.google.dev/gemini-api/docs/video-understanding)、[Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

## この変更で確認したこと

自動テスト38件、Astroの型検査、本体58ページとメンズ2ページのビルド、サブドメインのリンク検証、Workerの配布用バンドル、ローカルD1のマイグレーションを確認済み。承認記事のサンプルを取り込んだビルドで本文・一覧・検索・AI注記・HTMLの無害化も検証し、検証用データは除去した。ローカルWorkerでは公開ページ200、未認証の管理者アクセス403、Bot・export API401を確認した。

リモートの作業ブランチPreviewの表示・D1・認証の拒否は確認済み。実際のGemini/Workers AI、Accessログイン、Deploy Hookによる再ビルドの確認は、上の環境設定後に行う。
