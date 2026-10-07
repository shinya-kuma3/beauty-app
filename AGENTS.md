# beauty-app のブランチ運用

- 作業は `codex/` で始まる作業ブランチで進める。
- `develop` をテスト環境用の統合ブランチとする。ユーザーが「dev」と呼ぶ反映先も `develop` を指す。
- 変更を確認して作業ブランチでコミットした後、`develop` に取り込み、GitHub の `origin/develop` に push する。
- `main` は本番用として扱う。テスト環境への反映では更新しない。
