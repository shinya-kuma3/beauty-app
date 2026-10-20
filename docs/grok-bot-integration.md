> 現在の公開方法は [承認済み記事のGit同期と本番公開](approved-content-release.md) を参照してください。公開サイトは静的配信、管理APIは wrangler.pipeline.jsonc の保護されたWorkerです。以下には旧構成の説明も含まれます。

# Grok Bot の接続とAIの役割

## 現在の役割（2026-10-12）

| 担当 | 処理 |
| --- | --- |
| Grok Bot（外部） | X・海外の文章の収集、紹介内容・表記・読みやすさ・PR表示の確認、日本語の記事化、管理画面からの再チェック |
| Gemini（gemini-3.1-flash-lite） | 海外を含むYouTube動画を日本語で構造化要約、記事の200文字以内の短い要約 |
| Workers AI（@cf/baai/bge-m3） | 日本語対応の埋め込み、コサイン類似度による最大5タグ、保存した埋め込みによる類似記事検索 |
| 管理者・編集者 | 内容と結果の最終確認、編集、公開・却下 |

Workers AIで文章を生成する経路は削除しました。Geminiが429を返したときは翌日へ延期します。
古い SUMMARY_PROVIDER / FALLBACK_MODEL / REVIEW_INPUT_CHARS / REVIEW_MAX_TOKENS の設定は使用しません。
EMBEDDING_MODEL はBGE-M3のみ対応です。違うモデル名は設定エラーになり、生成モデルを呼びません。
海外Web・Xの文章素材はGrok Botが担当し、サイト内では埋め込みタグだけを処理します。
YouTubeは通常動画・Shortsを含む @EGA.channel 全体を対象とする初期設定を維持しています。
英語・韓国語なども1回のGemini呼び出しで日本語要約にし、terms に原語・日本語・言語コードを保存します。
新規動画の結果に terms を追加しました。過去の保存済み要約を無条件に再生成しません。

## 初期の記事化に使う既存API

- GET /api/ingest/sources?status=new：素材と日本語のYouTube要約を取得
- POST /api/ingest/sources：X・海外美容記事の素材を登録
- PATCH /api/ingest/sources/:id：used / rejected に更新
- POST /api/ingest/articles：任意の参考リンク citations と編集メモ ai_check_notes を添えて pending_review で登録

Grok Botは必要に応じて成分名の日本語と原語を併記します。動画の terms を確認し、元資料と照合してください。
AIによるチェックは原文を見た事実や医学的な安全性をサイト側で保証するものではありません。確認できない資料は不明と明記します。

## 管理画面からの再チェック（追加API）

管理画面の「Grok Botに再チェックを依頼」はD1に依頼を保存します。Grok Botは依頼一覧を定期取得します。
例えば15分ごとに取得してください。サイトがGrok Botへメッセージを送る設定は不要です。
このリポジトリには外部Grok Botそのものの実装・実行環境は含みません。
Botには既存の INGEST_API_KEY を環境変数またはシークレットとして登録してください。チャットやコードにキーを貼りません。
APIキーはサイト側の .dev.vars（Git対象外）または設定したシークレットの保管元から安全に渡します。

テスト用の接続先:

https://codex-content-review-pipeline-beauty-app.sinyak4649.workers.dev

### 依頼の取得

GET /api/ingest/checks?status=pending&limit=1

Authorization: Bearer INGEST_API_KEY

返却例:

~~~json
{
  "requests": [{
    "id": "request-uuid",
    "article_id": "article-uuid",
    "revision": 2,
    "content_hash": "sha256",
    "article": {
      "title": "保湿のケアを考える",
      "body_markdown": "## 肌の状態\n…",
      "excerpt": "保湿のヒント",
      "citations": ["https://example.org/paper"],
      "materials": [{"id":"source-uuid","title":"資料名","url":"https://example.org/paper","type":"research","language":"en","status":"new","raw_summary":"元の素材・動画の構造化JSON"}]
    },
    "instructions": "確認方針…"
  }]
}
~~~

本文・素材は切り詰めずに返します。取得では担当者メールや管理履歴を返しません。
revision は返信までそのまま持ち、本文・出典・素材が変わった依頼は破棄してください。
一覧取得後に編集が入ると、返信は409 check_obsoleteで拒否されます。
1回の返却は最大1記事、既定limit=1です。互換性のためlimit=2〜10も受け付けますが返す依頼は1件までです。各依頼を個別に返信してから、次を取得します。複数の依頼を一括の審査文脈にまとめないでください。

### 結果の返却

POST /api/ingest/checks/:id/result

Authorization: Bearer INGEST_API_KEY
Content-Type: application/json

~~~json
{
  "revision": 2,
  "ai_check_notes": "投稿の紹介内容と表記を確認しました。",
  "overview": "効能の断定を避け、紹介内容をわかりやすくしてください。",
  "findings": [{"severity":"warning","category":"claim","quote":"必ず改善します","reason":"効能の断定です。","suggestion":"使い心地の個人差がわかる表現へ修正してください。"}],
  "questions": ["商品名や使い方は投稿の紹介内容と一致していますか？"],
  "checked_citations": ["https://example.org/paper"],
  "primary_source_notes": "参考投稿の内容を確認しました。",
  "pr_notes": "広告・PR・利益相反の記載を確認しました。",
  "terms": [{"original":"ceramide","japanese":"セラミド","language":"en"}]
}
~~~

overview・findings・questions・pr_notes・termsは返信の形式として必要です。ai_check_notes・checked_citations・primary_source_notesは任意です。科学的根拠や一次研究の確認は掲載条件ではありません。
checked_citations は依頼された記事のcitationsにあるURLをそのまま返します。
findingsは最大6、questions最大3、terms最大20。categoryはclaim / evidence / wording / consistencyです。
同じ返信の再送はキャッシュ済みとして成功します。完了した依頼への異なる返信は409で拒否します。
返却例: {"id":"request-uuid","state":"complete","revision":3}
更新するのは確認メモとチェック結果だけです。本文・記事の公開状態は変えません。
編集者は新しい版を確認してから公開してください。

### curl の例

先にBOTのシークレット管理で INGEST_API_KEY を環境変数へ設定し、次を実行します。

~~~sh
export BEAUTY_API_URL="https://codex-content-review-pipeline-beauty-app.sinyak4649.workers.dev"
curl --fail-with-body "$BEAUTY_API_URL/api/ingest/checks?status=pending&limit=1" \
  -H "Authorization: Bearer $INGEST_API_KEY"

curl --fail-with-body "$BEAUTY_API_URL/api/ingest/checks/REQUEST_ID/result" \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @grok-check-result.json
~~~

## 編集者の停止・削除

管理者だけが利用中の編集者を停止できます。停止した行に「削除」を表示します。
DELETE /api/admin/editors に {"email":"editor@example.com"} を送信します。
利用中のメールは409、管理者のメールは400、編集者自身からの操作は403で拒否します。
停止・削除後は、既存の有効なAccess JWTでも次のサイト操作から拒否します。
編集者一覧からメールを削除しても、過去の編集・公開履歴と権限変更の履歴は監査のため残します。
Cloudflare AccessのAllowポリシーからも対象メールを削除してください。再登録は管理者による明示操作が必要です。

## 類似記事と運用

GET /api/admin/articles/:id/related は最新の保存済み埋め込みを比較します。AIの再計算はしません。
候補は同じ埋め込みモデルを使う直近100件の公開承認済み記事で、しきい値以上を最大5件返します。
管理画面で記事を開いて内容を確認できます。大量データの検索は将来Vectorizeへ移す余地を残します。

追加DB設定: migrations/0003_ai_roles.sql。
テスト用PreviewではCronを実行しないCloudflareの仕様に合わせ、管理画面で動画収集・要約タグ処理を実行します。
本番は1日1回の収集と、毎時の順次AI処理の既存Cronを使います。ENABLE_SCHEDULED=trueは本番公開時に設定します。
Grok Botの再チェックはCronのAI処理ではなく、外部Botの定期取得で進みます。
1日30回・600000予約トークンの上限、内容ハッシュ、タグ辞書と要約のキャッシュを維持しています。

## 1記事だけを指定して再チェックする

GET /api/ingest/checks/REQUEST_ID は {request: {...}} を返します。GET /api/ingest/checks?status=pending&article_id=ARTICLE_ID はその記事だけをrequests配列で返します。認証は従来のBearerキーです。対象がなければ個別IDは404、記事IDの絞り込みは空配列で、全体一覧へ切り替わることはありません。

各依頼はscope=single_article、request_endpoint、result_endpointを持ちます。article_id・revision・本文・紐づく素材だけを読み、同じ依頼のresult_endpointへ返してください。記事一覧や本番差分チェックの全記事を再取得して再チェックに混ぜないでください。

管理画面は対象タイトルと「この記事だけの依頼文をコピー」を表示します。対話型Botに1記事だけ依頼する場合は、その依頼文を渡してください。再チェック待ちの記事は一覧で緑色と「Grok再チェック中」を表示します。完了・古い版・公開済み記事は対象外です。
