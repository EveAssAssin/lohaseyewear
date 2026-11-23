/* =============================================
   LOHAS design tokens 產生器
   ---------------------------------------------
   用法(在 repo 根目錄):  node design/build.mjs
   正本:design/tokens.json —— 只改那一支,其他全部由這裡產生,不要手改:

     css/lohas-tokens.css   官網自己用的(只改寫 @tokens:start ~ @tokens:end 之間)
     design/v1/tokens.css   給其他網頁平台(只有變數)
     design/v1/tokens.scss  SCSS 變數 + map
     design/v1/tokens.js    JS / TS(ESM)
     design/v1/tokens.json  扁平版 JSON(App 或任何程式讀)
     design/v1/tailwind.preset.js
     design/v1/lohas-ui.js / lohas-ui.css   提示框元件(從 js/、css/ 複製)

   🚨 v1 只能「新增」token。改值或刪除會讓已經引用 v1 的平台畫面突然變掉 —— 那要出 v2。
      這支會擋:跟 design/v1/tokens.json 比對,既有 token 的值變了或不見了就停下來。
   ============================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = JSON.parse(fs.readFileSync(path.join(here, 'tokens.json'), 'utf8'));
const OUT = path.join(here, 'v1');
fs.mkdirSync(OUT, { recursive: true });

const all = src.groups.flatMap(g => g.tokens.map(t => ({ ...t, group: g.id, type: t.type || g.type })));
const flat = Object.fromEntries(all.map(t => [t.name, t.value]));

/* ---------- v1 只能新增 ---------- */
const prevPath = path.join(OUT, 'tokens.json');
if (fs.existsSync(prevPath) && !process.argv.includes('--allow-breaking')) {
  const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')).tokens || {};
  const broken = Object.keys(prev).filter(k => flat[k] !== prev[k]);
  if (broken.length) {
    console.error('🚨 v1 的既有 token 被改值或刪除了:\n' +
      broken.map(k => `   ${k}: ${prev[k]} → ${flat[k] ?? '(刪除)'}`).join('\n') +
      '\n   已引用 v1 的平台畫面會跟著變。要這樣做請出 v2;確定要覆蓋就加 --allow-breaking。');
    process.exit(1);
  }
}

const header = (c) => `${c} LOHAS 樂活眼鏡 design tokens v${src.version}(${src.updated})
${c} 由 design/build.mjs 從 design/tokens.json 產生,不要手改。說明:${src.homepage}
`;

/* ---------- CSS 變數區塊(官網與 v1 共用同一段文字) ---------- */
function cssVars(indent = '  ') {
  const lines = [];
  for (const g of src.groups) {
    lines.push(`${indent}/* === ${g.title} === */`);
    for (const t of g.tokens) {
      lines.push(`${indent}--${t.name}: ${t.value};${t.desc ? '  /* ' + t.desc + ' */' : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
const reduced = all.filter(t => t.reducedMotion);
const reducedBlock = `/* 使用者在系統設定「減少動態」時,用到動態 token 的元件一律不播動畫 */
@media (prefers-reduced-motion: reduce){
  :root{
${reduced.map(t => `    --${t.name}: ${t.reducedMotion};`).join('\n')}
  }
}`;
const tokensCss = `:root{\n${cssVars()}\n}\n\n${reducedBlock}\n`;

/* ---------- 官網 css/lohas-tokens.css:只改寫標記之間 ---------- */
{
  const p = path.join(root, 'css', 'lohas-tokens.css');
  const raw = fs.readFileSync(p, 'utf8');
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const S = '/* @tokens:start —— 這一段由 design/build.mjs 從 design/tokens.json 產生,不要手改 */';
  const E = '/* @tokens:end */';
  const a = raw.indexOf(S), b = raw.indexOf(E);
  if (a < 0 || b < 0) throw new Error('css/lohas-tokens.css 找不到 @tokens 標記');
  const body = (S + '\n' + tokensCss + E).replace(/\n/g, nl);
  fs.writeFileSync(p, raw.slice(0, a) + body + raw.slice(b + E.length));
}

/* ---------- v1/tokens.css ---------- */
fs.writeFileSync(path.join(OUT, 'tokens.css'), `/*\n${header(' *')} *\n * 只有變數,不含 reset。字體請另外載入:\n * <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap">\n */\n${tokensCss}`);

/* ---------- v1/tokens.scss ---------- */
const scssName = n => '$' + n;
fs.writeFileSync(path.join(OUT, 'tokens.scss'),
  `${header('//')}\n` +
  all.map(t => `${scssName(t.name)}: ${t.value};${t.desc ? ' // ' + t.desc : ''}`).join('\n') +
  `\n\n$lohas-tokens: (\n${all.map(t => `  '${t.name}': ${t.value},`).join('\n')}\n);\n` +
  `\n$lohas-breakpoints: (mobile: ${src.breakpoints.mobile}px, tablet: ${src.breakpoints.tablet}px, laptop: ${src.breakpoints.laptop}px);\n`);

/* ---------- v1/tokens.js ---------- */
const camel = n => n.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
fs.writeFileSync(path.join(OUT, 'tokens.js'),
  `${header('//')}\n` +
  `/** 扁平版:key 與 CSS 變數同名(不含 --) */\nexport const tokens = ${JSON.stringify(flat, null, 2)};\n\n` +
  `/** 駝峰版:給 React Native / JS 物件寫法 */\nexport const t = ${JSON.stringify(Object.fromEntries(all.map(x => [camel(x.name), x.value])), null, 2)};\n\n` +
  `export const breakpoints = ${JSON.stringify({ mobile: src.breakpoints.mobile, tablet: src.breakpoints.tablet, laptop: src.breakpoints.laptop })};\n` +
  `export const version = ${JSON.stringify(src.version)};\nexport default tokens;\n`);

/* ---------- v1/tokens.json(扁平 + 說明) ---------- */
fs.writeFileSync(path.join(OUT, 'tokens.json'), JSON.stringify({
  name: src.name, version: src.version, updated: src.updated, homepage: src.homepage,
  rules: src.rules,
  tokens: flat,
  meta: Object.fromEntries(all.map(t => [t.name, { group: t.group, type: t.type, desc: t.desc, css: '--' + t.name }])),
  groups: src.groups.map(g => ({ id: g.id, title: g.title, type: g.type, names: g.tokens.map(t => t.name) })),
  breakpoints: { mobile: src.breakpoints.mobile, tablet: src.breakpoints.tablet, laptop: src.breakpoints.laptop }
}, null, 2) + '\n');

/* ---------- v1/tailwind.preset.js ---------- */
const pick = type => Object.fromEntries(all.filter(t => t.type === type).map(t => [t.name, t.value]));
const byGroup = id => Object.fromEntries(all.filter(t => t.group === id).map(t => [t.name.replace(/^(fs|sp|r|sh)-/, ''), t.value]));
fs.writeFileSync(path.join(OUT, 'tailwind.preset.js'),
  `${header('//')}// 用法:tailwind.config.js 裡 presets: [require('./tailwind.preset.js')]\n` +
  `module.exports = {\n  theme: {\n    extend: ${JSON.stringify({
    colors: pick('color'),
    fontFamily: { tc: ['"Noto Sans TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'sans-serif'] },
    fontSize: byGroup('fontSize'),
    spacing: byGroup('space'),
    borderRadius: byGroup('radius'),
    boxShadow: byGroup('shadow'),
    zIndex: Object.fromEntries(all.filter(t => t.group === 'z').map(t => [t.name.replace(/^z-/, ''), t.value])),
    screens: { mobile: src.breakpoints.mobile + 'px', tablet: src.breakpoints.tablet + 'px', laptop: src.breakpoints.laptop + 'px' }
  }, null, 2).replace(/\n/g, '\n    ')}\n  }\n};\n`);

/* ---------- 提示框元件 ---------- */
fs.copyFileSync(path.join(root, 'js', 'lohas-ui.js'), path.join(OUT, 'lohas-ui.js'));
fs.copyFileSync(path.join(root, 'css', 'lohas-ui.css'), path.join(OUT, 'lohas-ui.css'));

console.log(`✓ ${all.length} 個 token → css/lohas-tokens.css、design/v1/(tokens.css / .scss / .js / .json / tailwind.preset.js / lohas-ui)`);
