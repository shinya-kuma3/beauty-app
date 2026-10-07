import { publishedIngredients, publishedArticles, pathTo } from '../lib/content';
export async function GET() {
  const [ingredients, articles] = await Promise.all([publishedIngredients(), publishedArticles()]);
  const entries = [...ingredients.map((entry) => ({ ...entry.data, type: 'ingredient', url: pathTo(`ingredients/${entry.id}/`) })), ...articles.map((entry) => ({ ...entry.data, type: 'article', url: pathTo(`articles/${entry.id}/`) }))];
  return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
