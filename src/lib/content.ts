import { getCollection } from 'astro:content';
export const categoryLabel = { skin: 'スキンケア', hair: 'ヘアケア' };
export function pathTo(path = '') { return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`; }
export function formatDate(date: string) { return date.replaceAll('-', '.'); }
export async function publishedIngredients() { return (await getCollection('ingredients', ({ data }) => data.status === 'published')).sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt) || a.id.localeCompare(b.id)); }
export async function publishedArticles() { return (await getCollection('articles', ({ data }) => data.status === 'published')).sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt) || a.id.localeCompare(b.id)); }
