import {readFile,access} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadLocalEnv,deploymentSettings} from './site-settings.mjs';
loadLocalEnv();if(process.argv.includes('--local')){process.env.PUBLIC_MAIN_SITE_URL='http://127.0.0.1:4325/';process.env.PUBLIC_MENS_SITE_URL='http://127.0.0.1:4326/';}
const urls=deploymentSettings(),base=(process.env.BASE_PATH||'/').replace(/\/$/,'');
const home=await readFile('dist/index.html','utf8'),old=await readFile('dist/mens/index.html','utf8'),retired=await readFile('dist-mens/index.html','utf8');
assert.ok(!home.includes('メンズケア')&&!home.includes('mens-button'));
assert.ok(old.includes('http-equiv="refresh"')&&!old.includes('mens-theme'));
assert.ok(retired.includes(urls.main)&&retired.includes('http-equiv="refresh"')&&!retired.includes('整える。'));
const redirects=await readFile('dist/_redirects','utf8');assert.ok(redirects.includes(base+'/mens/ '+base+'/ 301'));assert.ok(redirects.includes('/articles/mens-care-basics/ '+base+'/articles/ 301'));
assert.equal(await readFile('dist-mens/_redirects','utf8'),'/* '+urls.main+' 301\n');
await assert.rejects(access('dist/articles/mens-care-basics/index.html'));
console.log('Retired mens URLs verified: main-site redirects, no entrance or published mens article.');
