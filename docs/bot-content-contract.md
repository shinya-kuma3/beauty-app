# Grok bot の更新契約

## 予定する流れ

X で美容成分やケアの話題を見つける → 元の公式資料・研究を確認する → JSON ファイルを追加・更新する → GitHub の PR またはコミット → CI 検証 → マージ・ホスティング側のビルドで反映。

このアプリ側はファイルを読むところから担当します。X / Grok の API、bot の実行環境、GitHub の認証は後から接続します。

## bot が触るファイル

- 成分: `src/content/ingredients/<id>.json`
- 記事: `src/content/articles/<id>.json`

既存 ID を維持すると既存の URL を維持できます。重複作成を避け、ID の変更・削除はリンクの移行と一緒に扱ってください。UI、スキーマ、設定、依存関係は情報更新の対象に含めない運用を推奨します。

## 共通データ

| フィールド | 意味 |
| --- | --- |
| title | 日本語の成分名・記事タイトル（120字以内） |
| summary | 一覧や検索に使う説明（300字以内） |
| category | `skin` / `hair` |
| tags | 検索キーワードの配列（1〜8件） |
| status | `draft` / `published`（未指定は下書き） |
| updatedAt | 実在する `YYYY-MM-DD` の更新日 |
| sections | `{ heading, body }` の配列。プレーンテキスト。改行は `\n` |
| sources | `{ title, url, kind }` の配列。URL は HTTPS |
| discoveryUrls | 任意。話題を見つけた X 投稿等の HTTPS URL 配列 |

sources の kind は `guideline`（専門団体）、`research`（研究）、`official`（公式資料）、`x`（投稿）。公開するデータには少なくともひとつ、X 以外の参考資料が必要です。収集元の X 投稿は discoveryUrls に保存できます。discoveryUrls は来歴の保管用で、通常の詳細ページには表示しません。

## 成分だけのフィールド

`englishName`（英語名）、`role`（役割）、`caution`（選ぶ際の補足）が必要です。

```json
{
  "title": "調査中の成分",
  "englishName": "Ingredient Name",
  "summary": "資料を確認してから、ここに説明を記載します。",
  "category": "skin",
  "role": "調査中",
  "tags": ["美容成分"],
  "status": "draft",
  "updatedAt": "2026-10-07",
  "sections": [{ "heading": "調査メモ", "body": "原資料と研究条件の確認待ち。" }],
  "caution": "情報確認中。",
  "sources": [{ "title": "実際の資料名へ置き換える", "url": "https://example.com/source", "kind": "official" }],
  "discoveryUrls": []
}
```

これは形式の例です。URL・タイトル・更新日は実際の調査内容に置き換えてください。

## 記事だけのフィールド

`readingMinutes`（1〜60の整数）、任意の `relatedIngredients`（成分ファイルの ID 配列）。公開記事から参照する成分も公開済みである必要があります。

## 公開前の確認

新規情報は `draft` で追加して、出典・研究条件・表現を確認できる設計です。自動で `published` にするか、確認後に公開するかは bot の運用時に決めてください。X の反響や投稿文そのものを、効果の根拠として扱わないようにします。研究の対象、配合、結果の範囲を保ち、製品全体の効果へ広げて断定しないでください。

`npm run validate:content` で形式・参照を検査します。`npm run check` と `npm run build` でスキーマと画面生成を検査し、`npm run test:build` で公開データが一覧・詳細・検索へ反映されていることを確認します。CI は根拠の正しさ自体を判定するものではありません。

## 未決定の接続項目

GitHub リポジトリ、公開先、X の情報取得方法、Grok bot の実行場所、取得頻度、公開前の確認方法。API キーや GitHub トークンをコンテンツファイルへ保存しないでください。
