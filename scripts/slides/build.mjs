import { Marp } from '@marp-team/marp-core';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const docs = path.join(root, 'docs');
const cache = path.join(root, '.cache-docs/slides');
const source = path.join(docs, '03_marp_mobiltracer-review.md');
const latest = path.join(docs, '03_marp_mobiltracer-review.pdf');
const archiveDir = path.join(docs, 'pdf/slides');
const hash = data => createHash('sha256').update(data).digest('hex');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const python = path.join(root, '.venv-docs/bin/python');
const mode = process.argv[2] ?? '--build';
if (!['--check', '--draft', '--build', '--verify'].includes(mode)) throw new Error('不明なモード');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.cache-docs/browsers');
const { chromium } = await import('playwright');

function validatePdf(pdf, expected) {
  return JSON.parse(execFileSync(python, [path.join(here, 'validate.py'), pdf, expected], { encoding: 'utf8' }));
}

async function main() {
  const markdown = await fs.readFile(source, 'utf8');
  const version = markdown.match(/^deck_version: (\d+\.\d+\.\d+)$/m)?.[1];
  const requirementsVersion = markdown.match(/^requirements_version: (\d+\.\d+\.\d+)$/m)?.[1];
  if (!version || !requirementsVersion) throw new Error('説明資料版と参照原本版を指定してください');
  const requirements = await fs.readFile(path.join(docs, 'design.md'), 'utf8');
  if (!requirements.includes(`文書版: ${requirementsVersion}\n`)) throw new Error('参照する要件原本の版が変わっています');
  const design = await fs.readFile(path.join(docs, '02_slide-design_mobiltracer-review.md'), 'utf8');
  const plannedTitles = [...design.matchAll(/^### スライド\d{2}: (.+)$/gm)].map(match => match[1]);
  const parts = markdown.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\n---\n/);
  const titles = parts.map(part => part.match(/^#{1,2} (.+)$/m)?.[1]);
  if (parts.length !== 18 || JSON.stringify(titles) !== JSON.stringify(plannedTitles)) throw new Error('承認した18枚の構成と一致しません');
  const defined = new Set(requirements.match(/\b(?:FR-[A-Z]\d{2}|AC-\d{2}|NFR-\d{2}|GOAL-\d{3}|OQ-\d{3}|CON-\d{3})\b/g));
  for (const id of markdown.match(/\b(?:FR-[A-Z]\d{2}|AC-\d{2}|NFR-\d{2}|GOAL-\d{3}|OQ-\d{3}|CON-\d{3})\b/g) ?? []) {
    if (!defined.has(id)) throw new Error(`未定義の要件参照: ${id}`);
  }
  if (/<(?:script|iframe|object|embed|link)\b/i.test(markdown) || /TODO|FIXME|placehold\.jp/.test(markdown)) throw new Error('未配置画像や許可しないHTMLがあります');
  const marp = new Marp({ html: true });
  const inputs = {};
  for (const file of ['build.mjs', 'validate.py', 'package-lock.json', 'themes/classmethod.css', 'themes/mobiltracer.css']) {
    inputs[`scripts/slides/${file}`] = hash(await fs.readFile(path.join(here, file)));
  }
  for (const name of ['classmethod', 'mobiltracer']) marp.themeSet.add(await fs.readFile(path.join(here, `themes/${name}.css`), 'utf8'));
  const assets = new Map();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const relative = match[1];
    if (!/^assets\/slides\/[a-z-]+\.svg$/.test(relative)) throw new Error(`許可しない画像: ${relative}`);
    const file = path.join(docs, relative);
    const real = await fs.realpath(file);
    if (!real.startsWith(path.join(docs, 'assets/slides/'))) throw new Error('画像が許可範囲外です');
    const data = await fs.readFile(file);
    if (/<(?:image|script|foreignObject)\b|(?:href|src)\s*=/i.test(data.toString())) throw new Error(`外部参照を含むSVG: ${relative}`);
    inputs[`docs/${relative}`] = hash(data);
    assets.set(relative, `data:image/svg+xml;base64,${data.toString('base64')}`);
  }
  const rendered = marp.render(markdown);
  let html = rendered.html.replace(/src="([^"]+)"/g, (_, src) => {
    if (!assets.has(src)) throw new Error(`予期しないリソース: ${src}`);
    return `src="${assets.get(src)}"`;
  });
  const sourceHash = hash(markdown);
  const inputHash = hash(JSON.stringify(inputs));
  console.log(`説明資料チェック成功: v${version}, 18枚, 図${assets.size}点`);
  if (mode === '--check') return;
  await fs.mkdir(cache, { recursive: true });
  const expectedPath = path.join(cache, 'expected.json');
  let existing = null;
  await fs.mkdir(archiveDir, { recursive: true });
  for (const name of (await fs.readdir(archiveDir)).filter(name => name.endsWith('.json'))) {
    const meta = JSON.parse(await fs.readFile(path.join(archiveDir, name), 'utf8'));
    const file = path.join(archiveDir, meta.file);
    if (hash(await fs.readFile(file)) !== meta.pdf_sha256) throw new Error(`改訂版のハッシュ不一致: ${name}`);
    if (meta.deck_version === version) {
      if (existing) throw new Error('同版の改訂版が複数あります');
      existing = { file, meta };
    }
  }
  for (const name of (await fs.readdir(archiveDir)).filter(name => name.endsWith('.pdf'))) {
    await fs.access(path.join(archiveDir, name.replace(/\.pdf$/, '.json')));
  }
  if (mode !== '--draft' && existing) {
    if (existing.meta.source_sha256 !== sourceHash || existing.meta.inputs_sha256 !== inputHash || existing.meta.requirements_sha256 !== hash(requirements)) {
      throw new Error('保存済みの同版と内容・生成入力が違います。deck_versionを上げてください');
    }
    await fs.writeFile(expectedPath, JSON.stringify(existing.meta.expected));
    validatePdf(existing.file, expectedPath);
    if (mode === '--verify') {
      if (hash(await fs.readFile(latest)) !== existing.meta.pdf_sha256) throw new Error('最新版と改訂版が一致しません');
    } else await fs.copyFile(existing.file, latest);
    console.log(`保存済み改訂版を検証・再利用: ${path.relative(root, existing.file)}`);
    return;
  }
  if (mode === '--verify') throw new Error('現行版の説明用PDFがありません');
  const lock = path.join(docs, '.slides.lock');
  const handle = await fs.open(lock, 'wx').catch(() => { throw new Error('別のスライド生成が実行中、または中断したロックが残っています'); });
  let browser;
  try {
    const localFont = process.env.DOCS_FONT_PATH ?? path.join(root, '.venv-docs/fonts/NotoSansCJK-Regular.ttc');
    let font;
    try { await fs.access(localFont); font = localFont; }
    catch { font = execFileSync('fc-match', ['-f', '%{file}', 'Noto Sans CJK JP'], { encoding: 'utf8' }); }
    const config = path.join(cache, 'fonts.conf');
    await fs.writeFile(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include>/etc/fonts/fonts.conf</include><dir>${escape(path.dirname(font))}</dir><cachedir>${escape(path.join(cache, 'font-cache'))}</cachedir></fontconfig>`);
    const env = { ...process.env, FONTCONFIG_FILE: config };
    if (!execFileSync('fc-match', ['-f', '%{family}', 'Noto Sans CJK JP'], { encoding: 'utf8', env }).includes('Noto Sans CJK JP')) throw new Error('日本語フォントがありません');
    html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>MobilTracer 要件レビュー v${version}</title><style>${rendered.css}\n@page{size:1920px 1080px;margin:0}html,body{margin:0;padding:0}div.marpit>svg{display:block;width:1920px;height:1080px;break-after:page}div.marpit>svg:last-child{break-after:auto}</style><body>${html}</body></html>`;
    await fs.writeFile(path.join(cache, 'preview.html'), html);
    browser = await chromium.launch({ headless: true, env });
    const browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.marpit>svg>foreignObject>section')];
      const failures = [];
      const expected = sections.map((section, i) => {
        const box = section.getBoundingClientRect();
        for (const el of section.querySelectorAll('h1,h2,h3,p,li,th,td,footer,img')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height && (r.left < box.left - 1 || r.top < box.top - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1)) failures.push(`p.${i + 1}: ${el.textContent.slice(0,70) || el.getAttribute('alt')}`);
        }
        for (const img of section.querySelectorAll('img')) if (!img.complete || !img.naturalWidth) failures.push(`p.${i+1}: 画像未読込`);
        const fontSize = selector => { const el = section.querySelector(selector); return el ? getComputedStyle(el).fontSize : null; };
        return { title: section.querySelector('h1,h2').textContent, text: section.innerText, paginate: section.hasAttribute('data-marpit-pagination'), typography: { heading: fontSize('h1,h2'), lead: fontSize('.lead'), list: fontSize('li'), table: fontSize('table') } };
      });
      return { failures, expected };
    });
    if (result.failures.length || errors.length) throw new Error(`描画検査失敗: ${[...result.failures, ...errors].join(' / ')}`);
    await fs.writeFile(expectedPath, JSON.stringify(result.expected));
    const pdf = path.join(cache, 'draft.pdf');
    await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true, tagged: true });
    validatePdf(pdf, expectedPath);
    const previewDir = path.join(cache, 'preview');
    await fs.mkdir(previewDir, { recursive: true });
    for (let i = 0; i < 18; i++) await page.locator('.marpit>svg').nth(i).screenshot({ path: path.join(previewDir, `slide-${String(i + 1).padStart(2,'0')}.png`) });
    if (await fs.readFile(source, 'utf8') !== markdown) throw new Error('生成中に原本が変更されました。再実行してください');
    if (mode === '--draft') { console.log(`試作PDF・全18枚プレビュー: ${path.relative(root, cache)}`); return; }
    const now = new Date();
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false }).format(now);
    const filename = `mobiltracer-review-v${version}-${stamp.replace(/[-:]/g,'').replace(' ','T')}-JST.pdf`;
    const destination = path.join(archiveDir, filename);
    const meta = { deck_version: version, requirements_version: requirementsVersion, generated_at_jst: `${stamp.replace(' ','T')}+09:00`, file: filename, source: path.relative(root, source), source_sha256: sourceHash, requirements_sha256: hash(requirements), inputs_sha256: inputHash, inputs, slides: 18, pdf_sha256: hash(await fs.readFile(pdf)), render_environment: { node: process.version, chromium: browserVersion, font_sha256: hash(await fs.readFile(font)) }, expected: result.expected };
    await fs.copyFile(pdf, destination, 1);
    await fs.writeFile(destination.replace(/\.pdf$/, '.json'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
    const temp = path.join(docs, '.slides-latest.tmp');
    await fs.copyFile(pdf, temp); await fs.rename(temp, latest);
    console.log(`PDF生成成功: ${path.relative(root, latest)} / ${path.relative(root, destination)} (18枚)`);
  } finally {
    await browser?.close();
    await handle.close();
    await fs.unlink(lock);
  }
}

main().catch(error => { console.error(`スライド処理失敗: ${error.message}`); process.exitCode = 1; });
