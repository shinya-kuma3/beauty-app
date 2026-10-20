# 美容コンテンツの更新契約

最新の編集方針は[editorial-policy.md](editorial-policy.md)を参照してください。科学的根拠や論文は掲載条件ではありません。参考にしたX・YouTubeのリンクは残し、科学資料へのリンクは掲載しません。

現在のBotは[管理Worker API](grok-bot-integration.md)へ素材とpending_reviewの記事を提出します。管理者・編集者が公開承認し、Git同期と差分チェックを経て静的ページになります。BotにGitHubの書き込みや公開権限は不要です。

## 静的JSONの構成

- 成分: src/content/ingredients/<id>.json
- 初期記事: src/content/articles/<id>.json
- 管理画面で承認された記事: src/content/approved-articles/<id>.json

title、summary、category（skin/hair/nail/body）、tags、status（draft/published）、updatedAt、sectionsを持ちます。図鑑はenglishName・role・cautionを持ち、entryTypeはingredient（成分・既定）またはcare-item（導入液などのケアアイテム）で区分します。記事はreadingMinutes・relatedIngredientsも使います。sourcesは任意の参考リンク配列で、空配列を許可します。Xだけ・YouTubeだけで公開でき、別の資料を要求しません。

sourcesのkindはx、youtube、reference、officialを使えます。旧guideline/researchは互換性のため読み込めますが、科学資料は公開ページに表示しません。URLはHTTPSです。discoveryUrlsは任意の収集元URLです。

## 公開と検証

未承認の記事は公開しません。編集者は内容・表記・紹介の仕方を確認します。研究条件・一次研究・科学的根拠の確認は必須ではありません。紹介元にない体験や情報は創作しないでください。

npm run validate:contentはデータ形式と参照、npm run checkは型、npm run buildは静的ページ、npm run test:buildは公開ページと検索・リンクを確認します。これらは科学的裏付けを判定する検査ではありません。

成分診断の候補はsrc/lib/finder.mjsで管理します。対象部位・おすすめ理由・公開中の参照先を確認して変更します。成分を追加するだけでは診断候補へ自動追加しません。
