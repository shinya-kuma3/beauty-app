# beauty-app のブランチ運用（Git-flow）

- `main` は本番用。`develop` はテスト環境用の統合ブランチ。ユーザーが「dev」と呼ぶ反映先も `develop` を指す。
- 作業ブランチは Git-flow に従って作る。`codex/` で始まるブランチは新しく作らない。
  - 機能追加・改善・通常の修正：`develop` の最新から `feature/<内容>` を作る（例：`feature/admin-routing-dashboard`）。
  - 本番リリース：ユーザーが本番公開を明示的に依頼したときだけ、`develop` から `release/<YYYY-MM-DD>` を作る。検証後に `main` へマージしてタグ `vYYYY.MM.DD` を付け、`develop` にもマージし戻す。
  - 本番の緊急修正：ユーザーの明示的な依頼があるときだけ、`main` から `hotfix/<内容>` を作る。検証後に `main` と `develop` の両方へマージする。
- `feature/*` は変更を確認してコミットした後、`develop` に `--no-ff` で取り込み、GitHub の `origin/develop` に push する。
- `main` へのコード反映は `release/*` または `hotfix/*` 経由だけ。テスト環境への反映では `main` を更新しない。
- 承認記事の自動公開（GitHub Actions が記事JSONだけを `main` へ反映する仕組み）は、コードのリリースとは別に扱う。
- force push はしない。マージ済みの作業ブランチは削除してよい。
- 管理用 Cloudflare Preview の名前 `codex/content-review-pipeline` はGitのブランチ名ではないため変更しない（変えると別のPreviewになりシークレットも引き継がれない）。
