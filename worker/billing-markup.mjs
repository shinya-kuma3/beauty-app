export const billingMarkup = `<details id="billing-tools" hidden>
<summary>APIの利用量・料金</summary>
<p>取得できた利用量と請求履歴を確認します。残量が未取得のサービスは、公式画面で確認できます。料金・利用履歴は管理者だけに表示します。</p>
<form id="billing-filter" class="feedback-toolbar"><label for="billing-month">表示する年月（利用履歴・請求履歴）<input id="billing-month" type="month" required></label><button type="submit">利用量を更新</button><button id="billing-sync" type="button" disabled>Cloudflare請求履歴を取得</button></form>
<p id="billing-message" role="status" aria-live="polite"></p>
<div id="billing-summary"></div><div id="billing-providers" class="billing-grid"></div>
<details class="billing-import"><summary>Cursorの利用履歴CSVを取り込む</summary>
<p>Cursor → Dashboard → Usageで期間を選び、Export CSVを保存してください。CSVに含まれる範囲だけを集計し、同じファイルは重複加算しません。アカウント全体の履歴で、beauty-app以外の利用も含まれます。</p>
<form id="cursor-import"><label for="cursor-csv">利用履歴CSV（1.5MB・10,000行まで）<input id="cursor-csv" type="file" accept=".csv,text/csv" required></label><label class="consent"><input id="cursor-replace" type="checkbox" required>以前のCSV集計をこのファイルで置き換えることを確認しました</label><button type="submit">CSVを取り込む</button></form>
<p>対応列：Date（タイムゾーン付き）、Type、Cost。Total TokensやModelがあれば一緒に集計します。原本とメールアドレスは保存せず、年月・モデル・種別ごとの集計だけを保存します。契約枠の残量はCSVのCostから引き算しません。</p></details>
<div id="billing-models"></div><div id="billing-services" class="billing-grid"></div>
<p class="hint">実請求額、CSVの利用額、有料単価換算は意味が違うため、合計しません。料金・無料枠の確認日：<span id="billing-pricing-date"></span></p>
</details>`;
