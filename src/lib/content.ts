import visibility from '../content/withdrawn-articles.json';
import {parseVisibility} from '../../shared/withdrawal-content.mjs';
const hiddenArticles=new Set(parseVisibility(JSON.stringify(visibility)).withdrawals.map(row=>row.slug));
import { getCollection } from 'astro:content';
import { mainLink, mensLink } from './site-links.mjs';
export const isMensSite = import.meta.env.PUBLIC_SITE_VARIANT === 'mens';
export const mainSiteUrl = import.meta.env.PUBLIC_MAIN_SITE_URL || '';
export const mensSiteUrl = import.meta.env.PUBLIC_MENS_SITE_URL || '';
export function mainPathTo(path = '') { return mainLink(path, { base: import.meta.env.BASE_URL, mainUrl: mainSiteUrl, mensSite: isMensSite }); }
export function mensPathTo() { return mensLink({ base: import.meta.env.BASE_URL, mensUrl: mensSiteUrl, mensSite: isMensSite }); }
export const categoryLabel = { skin: 'スキンケア', hair: 'ヘアケア', nail: '爪ケア', body: 'ボディケア' };
export function pathTo(path = '') { return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`; }
export function formatDate(date: string) { return date.replaceAll('-', '.'); }
export async function publishedIngredients() { return (await getCollection('ingredients', ({ data }) => data.status === 'published')).sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt) || a.id.localeCompare(b.id)); }
export async function publishedArticles() { return (await getCollection('articles', ({ data,id }) => data.status === 'published' && !hiddenArticles.has(id))).sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt) || a.id.localeCompare(b.id)); }
