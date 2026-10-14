import test from "node:test";
import assert from "node:assert/strict";
import {
  publicReferences,
  isScientificReference,
} from "../shared/editorial-policy.mjs";
import { renderPublicMarkdown } from "../worker/core.mjs";
import {
  exportedArticle,
  toStaticArticle,
  staticArticleSchema,
} from "../shared/release-content.mjs";
import { loadRecords } from "../scripts/validate-content.mjs";

test("Scientific reference links are omitted but original X and YouTube attribution survives", () => {
  const list = [
    {
      title: "論文",
      url: "https://pubmed.ncbi.nlm.nih.gov/123/",
      kind: "reference",
    },
    {
      title: "ケア",
      url: "https://www.aad.org/public/care",
      kind: "reference",
    },
    {
      title: "美容の研究についての投稿",
      url: "https://x.com/example/status/123",
      kind: "x",
    },
    {
      title: "科学を話題にした動画",
      url: "https://www.youtube.com/watch?v=example",
      kind: "reference",
    },
    {
      title: "公式製品ページ",
      url: "https://example.org/product",
      kind: "official",
    },
  ];
  assert.deepEqual(
    publicReferences(list).map((s) => s.url),
    list.slice(2).map((s) => s.url),
  );
  assert.equal(
    isScientificReference({
      url: "https://www.youtube.com.evil.test/item",
      kind: "research",
    }),
    true,
  );
  assert.equal(publicReferences([]).length, 0);
});
test("Public Markdown removes only scientific anchors while preserving labels and social/video links", () => {
  const html = renderPublicMarkdown(
    "[論文](https://pubmed.ncbi.nlm.nih.gov/123/) **美容** [投稿](https://x.com/u/status/123) [動画](https://youtu.be/example)",
  );
  assert.doesNotMatch(html, /href="https:\/\/pubmed/);
  assert.match(html, /論文/);
  assert.match(html, /<strong>美容<\/strong>/);
  assert.match(html, /href="https:\/\/x.com/);
  assert.match(html, /href="https:\/\/youtu.be/);
  assert.doesNotMatch(
    renderPublicMarkdown("<script>alert(1)</script>"),
    /<script>/,
  );
});
test("Approved static snapshots support empty reference lists through the complete export contract", () => {
  const row = exportedArticle.parse({
    id: "12345678-1234-4234-8234-123456789abc",
    slug: "beauty-story",
    title: "今日の美容の話題",
    body_markdown:
      "## 日々のケア\n気になる商品の使い心地を見ながら、毎日のケアを楽しむためのヒントをまとめた記事です。",
    excerpt: "気になる美容の話題。",
    category: "skin",
    tags: ["スキンケア"],
    updated_at: "2026-10-14T00:00:00Z",
    published_at: "2026-10-14T00:00:00Z",
    revision: 1,
  });
  assert.deepEqual(row.citations, []);
  assert.deepEqual(staticArticleSchema.parse(toStaticArticle(row)).sources, []);
});
test("The evidence-reading article is archived and public initial content contains no scientific reference links", async () => {
  const records = await loadRecords();
  assert.equal(
    records.find((r) => r.id === "reading-ingredient-information").data.status,
    "draft",
  );
  for (const r of records.filter((r) => r.data.status === "published")) {
    assert.deepEqual(publicReferences(r.data.sources), r.data.sources);
    assert.ok(!r.data.tags.includes("研究"));
    assert.doesNotMatch(
      r.data.sections.map((s) => s.heading + " " + s.body).join(" "),
      /研究|論文|米国皮膚科学会|米国食品医薬品局|\bAAD\b|\bFDA\b|\bCIR\b/,
    );
  }
});
