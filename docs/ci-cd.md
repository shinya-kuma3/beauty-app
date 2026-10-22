# CI/CD（GitHub Actions）

## 構成

- `.github/workflows/ci.yml`：`develop`・`main` 宛ての PR と、両ブランチへの push で、型チェック・テスト・ビルド・ビルド検証を Node 24 で実行する。ジョブ名 `verify` をマージの必須条件にする。承認記事のファイルだけの push は、公開用ワークフロー側で検証するため対象外。同じブランチの古い実行は自動で取り消す。
- `.github/dependabot.yml`：npm と GitHub Actions の更新を、毎週月曜9時（日本時間）に `develop` 宛ての PR で作る。minor・patch はまとめて1つの PR。設定は既定ブランチ（main）にあるものが使われる。
- `.github/workflows/content-release.yml`：承認記事の自動公開。リポジトリ変数 `RELEASE_APP_ID` があれば専用 GitHub App のトークンで `develop`・`main` に書き込む。未設定なら従来の `GITHUB_TOKEN` を使う。
- `docs/github-ruleset.json`：`develop`・`main` のブランチ保護（ルールセット）。削除・force push を禁止し、PR と `verify` の成功を必須にする。マージ方法は merge commit のみ。

## 導入の順番（順番を守る）

ルールセットは、自動公開が GitHub App で書き込むようになってから有効にする。先に有効にすると、`GITHUB_TOKEN` による自動公開が拒否されて止まる（`GITHUB_TOKEN` はルールセットの例外にできない）。

1. **Dependabot の通知を有効にする**：リポジトリの Settings → Advanced Security（または Code security）で、Dependency graph と Dependabot alerts を有効にする。Dependabot security updates は無効のまま（main 宛ての自動 PR を作らないため）。
2. **GitHub App を作る**：GitHub の Settings → Developer settings → GitHub Apps → New GitHub App。
   - GitHub App name：重複しない名前（例：`beauty-app-release-<アカウント名>`）。Homepage URL：`https://my-beauty-palette.com`。
   - Webhook の Active はオフ。
   - Repository permissions：Contents を Read and write（Metadata は自動で Read-only）。ほかは No access。
   - Where can this GitHub App be installed?：Only on this account。
   - 作成後、App ID を控え、「Generate a private key」で秘密鍵（.pem）をダウンロードする。
   - 「Install App」→ 自分のアカウント → Only select repositories → `beauty-app`。
3. **リポジトリに登録する**：beauty-app の Settings → Secrets and variables → Actions。
   - Variables に `RELEASE_APP_ID`（App ID）。
   - Secrets に `RELEASE_APP_PRIVATE_KEY`（.pem ファイルの中身全体）。ダウンロードした .pem は登録後に安全な場所へ移すか削除し、Git やチャットに貼らない。
4. **この設定を main に入れる**（`hotfix/ci-cd-foundation` を main と develop にマージ）。
5. **自動公開を手動で1回実行する**：Actions → Approved article publication → Run workflow（main）。ログに「Create release App token」が成功していることを確認する。
6. **ルールセットを有効にする**：Settings → Rules → Rulesets → New ruleset → Import a ruleset で `docs/github-ruleset.json` を読み込む。Bypass list に手順2の GitHub App を追加して保存する。
7. **確認**：`feature/*` を push して `develop` 宛ての PR を作り、`verify` が成功するまでマージできないこと、成功後に「Create a merge commit」でマージできることを確認する。

## 日々の流れ（ルールセット導入後）

1. `develop` から `feature/<内容>` を作り、コミットして push する。
2. GitHub で `develop` 宛ての PR を作る（`gh pr create --base develop` でも可）。
3. `verify` が成功したら「Create a merge commit」でマージし、手元の `develop` を `git pull` する。
4. 本番リリースは `release/<日付>`、緊急修正は `hotfix/<内容>` を作り、`main` 宛ての PR で同様にマージする。続けて `develop` へも反映する。

## Actions の利用時間（非公開リポジトリ）

GitHub Free の非公開リポジトリは月2,000分まで無料。承認記事の自動公開は15分ごと（月約2,900回）に動くため、これだけで枠を超える可能性がある。Settings → Billing で使用量を確認し、必要なら実行間隔を広げる。
