# 記事の非公開・メンズケアの廃止

## 管理画面

「公開記事の管理・非公開」は管理者・編集者に表示します。初期JSON記事とD1の記事を対象に、記事タイトル・公開ページを確認し、理由とチェックを入力して非公開を依頼します。本文は削除しません。停止履歴は article_withdrawals に保存します。記事編集一覧の published は「公開承認済み」を示すため、公開停止の状態はこの欄で確認してください。

GET /api/admin/publications?q=&status=all|visible|withdrawn&limit=20&offset=0
POST /api/admin/publications/withdraw {slug,revision_token,reason,confirmed:true}
Access認証・更新の同一Origin・最新の記事版を検証します。理由と操作者は公開側のJSONには含めません。Botにはこの操作を許可しません。

## 反映

既存のGitHub Actions（15分ごとの Approved article publication）が RELEASE_API_KEY で非公開一覧を取得します。develop → main の順に、src/content/withdrawn-articles.json だけを更新します。mainでは信頼済みコードで検証してから反映し、既存の本番Deploy Hookを呼びます。本文・出典の変更や通常の新規公開は従来どおりGrokチェックが必要です。非公開にAIは呼びません。

GET /api/release/withdrawals → version:1,withdrawals:[{id,slug}]
GET /api/release/withdrawals/pending → ids
POST /api/release/withdrawals/build → withdrawals,main_sha,build_id

公開manifestで停止IDが確認できたら「非公開の反映済み」と表示します。GitHub同期待ち／再ビルド待ちは未完了です。Hook失敗は次回のActionsで再試行し、同じ非公開commitを繰り返しません。自動処理で停止履歴の削除・再公開はできません。

追加のSecretは不要です。管理D1へ 0007_article_withdrawals.sql を適用し、管理WorkerのPreviewを更新します。初回は今回のコードをmainへリリースしてから非公開の自動同期が動きます。

## メンズケア

メンズ用ヘッダー・フッター・専用画面を撤去し、mens-care-basics は下書きへ変更しました。/mens/ は同じサイトのTOPへ、旧メンズ記事URLは記事一覧へ転送します。

src-mens と wrangler.mens.jsonc はサブドメイン廃止時の転送用に残しています。npm run build:mens は専用コンテンツを生成せず、既存のmensホストを本体へ転送するアセットだけを生成します。DNSやWorkerそのものは削除しません。本番の転送アセットのデプロイは、別途リリース指示を受けて行います。
