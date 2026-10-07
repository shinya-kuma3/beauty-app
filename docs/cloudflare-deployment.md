# Cloudflare で本体とメンズを公開する

## 完成後のアドレス

| 公開先 | URL | 内容 |
| --- | --- | --- |
| 総合サイト | https://my-beauty-palette.com/ | トップ、成分図鑑、ケア記事、検索、診断 |
| メンズ | https://mens.my-beauty-palette.com/ | 濃い青のメンズトップ。図鑑・記事・診断は総合サイトへ |

同じ GitHub リポジトリ `shinya-kuma3/beauty-app` を Cloudflare Pages の2つのプロジェクトへ接続します。記事 JSON は共通なので、Grok bot がファイルを更新し main へ反映すると、両方の公開先を再ビルドできます。アプリにデータベースやログインサーバーは必要ありません。

本体を公開している Pages プロジェクトがすでにある場合は、それを使います。メンズ用だけを追加し、本体のビルド設定とリンクを更新してください。

## Cloudflare で入力する値

下記のプロジェクト名は作成時の推奨名です。まだアカウント内に作成されたという意味ではありません。

| 設定項目 | 本体 | メンズ |
| --- | --- | --- |
| プロジェクト名 | `my-beauty-palette` | `my-beauty-palette-mens` |
| GitHub リポジトリ | `shinya-kuma3/beauty-app` | 同左 |
| Production branch | `main` | `main` |
| Framework preset | `None`（下の値を手入力） | `None`（下の値を手入力） |
| Build command | `npm run build` | `npm run build:mens` |
| Build output directory | `dist` | `dist-mens` |
| Root directory | リポジトリのルート | リポジトリのルート |
| 環境変数 `NODE_VERSION` | `24` | `24` |
| Custom domain | `my-beauty-palette.com` | `mens.my-beauty-palette.com` |

公開ドメインは `site.config.mjs` に設定済みです。異なる公開 URL を使う場合のみ、ビルド環境の `PUBLIC_MAIN_SITE_URL` と `PUBLIC_MENS_SITE_URL` で上書きできます。これらは公開情報であり、API キーではありません。

## 公開までの操作

1. コードを確認して GitHub に push します。まず設計ブランチを Preview として確認し、確認後に main へ反映します。
2. Cloudflare の **Workers & Pages** で Pages のプロジェクトを作成し、GitHub を接続して上記の本体設定を入力します。
3. 同じリポジトリからもうひとつ Pages プロジェクトを作り、メンズ設定を入力します。
4. 両プロジェクトのビルドが成功したら、それぞれ **Custom domains → Set up a domain** で対応するドメインを登録します。
5. ドメインがこの Cloudflare アカウントで管理されていれば、表示される DNS 設定を確認して接続します。既存サイトのレコードを置き換える必要が表示された場合は、その公開先を確認してから進めてください。
6. 両方が Active になったら、総合サイトのメンズボタン、メンズ側の「総合トップ」、記事・診断へのリンクを確認します。

DNS に CNAME を追加するだけでは Pages との関連付けが完了しません。先に Pages の Custom domains で登録してください。CNAME の宛先は、実際に作成されたメンズプロジェクトの `*.pages.dev` アドレスです。

## 旧リンクと SEO

旧 URL `https://my-beauty-palette.com/mens/` は、新しいメンズトップへ転送します。本体のビルド時に Cloudflare 用 `dist/_redirects` を生成し、HTTP 301 を設定します。Astro の静的リダイレクト HTML も生成するため、ローカルプレビューでも転送先を確認できます。

メンズの canonical は `https://mens.my-beauty-palette.com/`。共通の成分図鑑・記事・診断をメンズ側に重複生成しません。

## ローカルでの確認

本体: `npm run dev`（http://127.0.0.1:4325/）

メンズ: 別のターミナルで `npm run dev:mens`（http://127.0.0.1:4326/）

本体のローカル表示では、メンズボタンから同じポートの `/mens/` を開きます。総合トップや記事・診断にも同じポートで戻るため、メンズ用サーバーは不要です。`npm run dev -- --port 4335` のようにポートを変更しても利用できます。

独立したメンズサイトを確認する場合だけ、別のターミナルで `npm run dev:mens` を起動します。この単独サイトから本体へのリンクは標準ポート 4325 です。

生成結果を確認する場合:

```sh
npm run build:local
npm run build:mens:local
node scripts/verify-subdomains.mjs --local
npm run preview
# 別のターミナル
npm run preview:mens
```

ローカル向けのビルドは、本番へアップロードしないでください。Cloudflare の Build command では必ず `npm run build` / `npm run build:mens` を使います。

## 現在の接続状況

リポジトリ内の公開構成を用意した状態です。Cloudflare Pages プロジェクトの作成、GitHub アプリの接続、DNS の変更は、このファイルやビルドだけでは実行されません。

参考: [Cloudflare・同じリポジトリから複数プロジェクトを公開する](https://developers.cloudflare.com/pages/configuration/monorepos/)、[ビルド設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[カスタムドメイン](https://developers.cloudflare.com/pages/configuration/custom-domains/)、[Astro の静的リダイレクト](https://docs.astro.build/en/reference/configuration-reference/#redirects)
