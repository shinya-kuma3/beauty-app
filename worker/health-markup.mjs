export const healthMarkup = `<details id="health-tools" hidden>
<summary>サイトの稼働状況・無料枠 <span id="health-badge" class="health-chip">未取得</span></summary>
<p class="hint">Cloudflareアカウント全体の利用量と、Worker・DBごとの内訳を確認できます。静的ページの閲覧はWorkerの実行回数に含みません。</p>
<div class="feedback-toolbar"><button id="health-refresh" type="button">最新の利用状況を取得</button><span id="health-period" class="hint"></span></div>
<p id="health-message" role="status" aria-live="polite"></p>
<p id="health-plan" class="hint"></p>
<div id="health-setup" class="health-notice" hidden><h3>利用量の取得には初回設定が必要です</h3><ol><li>CloudflareのAPIトークンを作成します。対象アカウントの「Account Analytics：Read」「D1：Read」だけを許可してください。</li><li>管理Workerのテスト環境に、シークレット <code>CLOUDFLARE_ANALYTICS_TOKEN</code> として保存します。記事収集用キーや請求用キーとは別です。</li><li>保存後、この画面を開き直して「最新の利用状況を取得」を押してください。</li></ol><p>キーを記事・チャット・入力フォームに貼り付ける必要はありません。詳しい設定手順は docs/cloudflare-monitoring.md にあります。</p><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer">CloudflareのAPIトークン画面</a></div>
<div id="health-quotas" class="billing-grid"></div>
<p class="hint">日次の枠は日本時間09:00（UTC 00:00）にリセットされます。容量は日次リセットされません。Analyticsには集計遅延やサンプリングがあり、残量は取得時点の目安です。80%で注意、100%で上限表示になります。</p>
<div id="health-errors"></div><p id="health-local-errors" class="health-notice"></p>
<details class="health-detail" open><summary>Workerの内訳とエラー</summary><p class="hint">実行エラーは例外・CPU上限超過などの実行状態です。アプリが返したHTTP 4xx/5xxとは別で、エラー本文や個人情報は取得しません。</p><p id="health-workers-note" class="hint"></p><div id="health-workers"></div></details>
<details class="health-detail" open><summary>DBの負荷・容量</summary><p class="hint">課金・無料枠はクエリの回数ではなく、実際に読み書きした行数で計算します。P90は90%の処理が収まる時間で、CPU使用率ではありません。</p><p id="health-d1-note" class="hint"></p><div id="health-databases"></div></details>
<details class="health-detail"><summary>今日の時間帯別の推移</summary><p class="hint">日本時間で表示。アカウント全体のWorker実行とD1の読み書きです。</p><div id="health-hourly"></div></details>
<p class="health-links"><a id="health-workers-link" target="_blank" rel="noopener noreferrer">CloudflareでWorkerの詳細・ログを確認</a><a id="health-d1-link" target="_blank" rel="noopener noreferrer">CloudflareでD1の詳細を確認</a></p>
<p class="hint">無料枠・制限の確認日：2026-10-20。Freeの上限超過は、通常は自動課金ではなく処理の制限になります。上限に達すると、この画面も取得できない場合があるためCloudflare側でも確認してください。</p>
</details>`;
