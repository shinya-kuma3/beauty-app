# 公開記事の改訂・Grok修正案の比較

管理者と編集者は、管理画面の「公開記事の管理・編集・非公開」から「編集する」を押すと初期記事も改訂できます。記事詳細の「この記事を編集する」からも改訂できます。
改訂中は既存の静的ページを保持します。保存・AI要約/タグ処理・公開承認を経て、従来のGitHub同期/Grok本番差分確認/再ビルド後に同じURLへ反映されます。更新日は新しい承認日時の日本時間の日付です。

Grokチェックでは現在の記事本文とproposed_body_markdownの全文を並べ、削除/追加の行を色と記号で表示します。「変更を採用する」は下書き本文だけを差し替え、「変更しない」は本文を保持します。どちらも操作者・日時・版を履歴へ記録します。未保存の編集・古い本文・別の記事の依頼・二重採用は拒否します。修正案の採用は公開承認とは別です。

## API（Cloudflare Access認証、管理者・有効な編集者）
- POST /api/admin/publications/edit: {slug, revision_token}。公開記事一覧のトークンを送り、初期記事の取り込みまたは公開済みDB記事の改訂を開始。{id,status,revision}を返す。
- POST /api/admin/articles/:id/revise: {revision}。公開済みDB記事の改訂を開始。
- POST /api/admin/articles/:id/checks/:checkId/decision: {revision,decision:"accepted"|"declined"}。本文の同一性と版を確認して決定を記録。競合は409。
- GET /api/admin/articles/:id: checkにoriginal_body_markdown、proposal_decision、decided_by、decided_atを追加。

## Grok Botの結果JSON（既存Bearer API）
POST /api/ingest/checks/:id/result の既存項目に、任意のproposed_body_markdown（40〜50,000文字の本文全体）を追加。Botから管理APIや本文の直接更新・公開は不可。旧形式は引き続き受理し、修正案がなければ比較ボタンを表示しない。
Botへの追記指示はgrok-individual-recheck-prompt.txtに記載。

## 導入
migrations/0009_article_proposals.sqlを管理WorkerのテストD1だけに適用し、管理用Previewとdevelopの静的Previewを更新する。新しいシークレットは不要。
承認済み初期記事のスナップショットにはoriginalSlugを保存し、同名の初期ファイルだけをAstroの読み込み対象から除外する。未承認DB行は出力しない。初期ファイルは削除しない。
旧記事のスナップショットとハッシュは維持し、新しい公開承認からdisplay_updated_atを使用する。
