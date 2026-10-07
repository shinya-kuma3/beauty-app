# beauty-app / beauty note

肌と髪の成分図鑑・ケア記事・検索を提供する日本語の美容ライブラリです。白と清潔感のある青を中心に、スマートフォンと PC に対応しています。

## 基盤

Astro 7 + TypeScript。静的サイトとして生成するため、公開ページのためのデータベースや常駐サーバーは不要です。記事と成分は `src/content/` の JSON ファイルに分離してあり、GitHub の更新に合わせて再ビルドできます。

## 開発

Node.js 24 LTS 推奨（最低 22.19）。

```sh
npm ci
npm run dev
```

ローカル URL: http://127.0.0.1:4325/

```sh
npm run check
npm test
npm run build
npm run test:build
npm run preview
```

`dist/` が公開成果物です。静的サイト対応のホスティングで利用できます。公開先はまだ接続していません。

## ページ

- `/` — トップページ
- `/ingredients/` — 成分図鑑・カテゴリ絞り込み
- `/ingredients/<id>/` — 成分の役割・説明・参考資料
- `/articles/` — ケア記事・カテゴリ絞り込み
- `/articles/<id>/` — ケア記事・関連成分・参考資料
- `/search/` — 成分名・英語名・本文・タグの検索、カテゴリと種類の絞り込み
- `/about/` — 情報の方針

検索語は URL に反映されます。複数のキーワードは AND 検索。全角英数字と半角英数字、英語の大文字小文字を同一視します。

## 記事と成分の更新

`src/content/ingredients/<id>.json` または `src/content/articles/<id>.json` を追加・編集します。ID は小文字英数字とハイフンを使ったファイル名。ファイルを追加すると詳細ページ・一覧・検索に自動反映します。

`status` は `draft` または `published`。未指定は `draft` です。下書きは公開ページ・検索に出力されません。データのスキーマは `src/content.config.ts` に定義しています。参考資料、実在する更新日、関連成分の参照先などを検査します。

Grok bot を接続するための契約は [docs/bot-content-contract.md](docs/bot-content-contract.md) を参照してください。

## GitHub と公開

`.github/workflows/ci.yml` は push / PR の検証用です。デプロイは行いません。GitHub リポジトリと公開先を決めたあと、main ブランチの更新で `npm run build` → `dist/` のデプロイを接続してください。

ドメインが決まったら `SITE_URL` を設定すると canonical URL を出力します。GitHub Pages のプロジェクト公開などでサブパスが必要な場合は、ビルド環境で `BASE_PATH=/beauty-app/` を指定します。プレビューと本番で同じ設定を使ってください。

X / Grok API の接続・スケジュール実行・GitHub への push は、今回のアプリには含めていません。API キーは bot 実行環境のシークレットとして管理します。

## 初期コンテンツ

成分6件、記事3件。出典を確認して作成した基本情報であり、X の最新投稿を取り込んだものではありません。各ページに参考資料と更新日を表示します。本文はプレーンテキストとして表示し、コンテンツ内の HTML やスクリプトは実行しません。

文字表示に Google Fonts を利用しています。通信できない場合は端末の日本語フォントへフォールバックします。
