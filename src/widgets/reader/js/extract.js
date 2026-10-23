/* Dot Reader: turns a downloaded web page into reading-mode blocks.
 * Uses Mozilla Readability (Firefox's Reader View) when it's installed, otherwise a
 * simpler built-in article finder. The page is parsed as inert data: its scripts never
 * run, its images never load, and none of its HTML is ever put on screen. */
(function (WT) {
  'use strict';
  const MAX_BLOCKS = 4000;
  const SKIP = 'script,style,noscript,template,iframe,object,embed,svg,canvas,form,button,input,select,textarea,nav,aside,footer,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],[hidden]';

  function resolve(href, base) {
    if (!href || /^\s*(javascript|data|mailto|tel):/i.test(href)) return null;
    if (/^\s*#/.test(href)) return null;           // a jump within the page
    try {
      const u = new URL(href, base);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch (e) { return null; }
  }
  const squash = (s) => String(s || '').replace(/\s+/g, ' ');

  /** Inline content -> runs [[text, {href}]], stopping at nested lists. */
  function runsOf(el, base) {
    const runs = [];
    const add = (text, href) => {
      if (!text) return;
      const last = runs[runs.length - 1];
      if (last && (last[1].href || null) === (href || null)) last[0] += text;
      else runs.push([text, href ? { href } : {}]);
    };
    (function walk(node, href) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { add(squash(c.nodeValue), href); continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol' || tag === 'script' || tag === 'style' || tag === 'sup' && /cite|ref|note/i.test(c.className)) continue;
        if (tag === 'br') { add(' ', href); continue; }
        if (tag === 'img') continue;
        walk(c, tag === 'a' ? resolve(c.getAttribute('href'), base) || href : href);
      }
    })(el, null);
    // Tidy the ends.
    if (runs.length) { runs[0][0] = runs[0][0].replace(/^\s+/, ''); const l = runs[runs.length - 1]; l[0] = l[0].replace(/\s+$/, ''); }
    return runs.filter((r) => r[0]);
  }
  const textOf = (runs) => runs.map((r) => r[0]).join('').trim();

  const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'figure', 'img', 'hr', 'table', 'div', 'section', 'article', 'main', 'header', 'dl', 'dt', 'dd', 'details', 'summary', 'picture']);

  /** Block-level walk of the article body. */
  function blocksOf(root, base, title) {
    const out = [];
    const push = (b) => { if (out.length < MAX_BLOCKS) out.push(b); };
    const para = (el, t) => { const r = runsOf(el, base); if (textOf(r)) push({ t, r }); };
    (function walk(el) {
      for (const c of el.children) {
        if (out.length >= MAX_BLOCKS) return;
        if (c.matches && c.matches(SKIP)) continue;
        const tag = c.tagName.toLowerCase();
        if (tag === 'h1' || tag === 'h2') {
          const r = runsOf(c, base);
          if (textOf(r) && textOf(r).toLowerCase() !== String(title || '').trim().toLowerCase()) push({ t: 'h2', r });
        } else if (/^h[3-6]$/.test(tag)) para(c, 'h3');
        else if (tag === 'p' || tag === 'summary' || tag === 'dt' || tag === 'dd') para(c, 'p');
        else if (tag === 'ul' || tag === 'ol') {
          let n = 0;
          for (const li of c.children) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            n++;
            const r = runsOf(li, base);
            if (textOf(r)) push({ t: 'li', r, n: tag === 'ol' ? n : 0 });
            for (const sub of li.querySelectorAll(':scope > ul, :scope > ol')) walk({ children: [sub] });
          }
        } else if (tag === 'blockquote') {
          const r = runsOf(c, base);
          if (textOf(r)) push({ t: 'quote', r });
        } else if (tag === 'pre') {
          const t = (c.textContent || '').replace(/\t/g, '  ').replace(/\s+$/, '');
          if (t) push({ t: 'pre', r: [[t.slice(0, 6000)]] });
        } else if (tag === 'figure' || tag === 'picture') {
          const cap = c.querySelector('figcaption');
          const img = c.querySelector('img');
          const text = squash(cap ? cap.textContent : img ? img.getAttribute('alt') : '').trim();
          push({ t: 'img', r: text ? [[text]] : [] });
        } else if (tag === 'img') {
          const alt = squash(c.getAttribute('alt')).trim();
          const w = Number(c.getAttribute('width') || 0);
          if (!w || w >= 80) push({ t: 'img', r: alt ? [[alt]] : [] });     // skip tiny icons
        } else if (tag === 'hr') push({ t: 'hr' });
        else if (tag === 'table') {
          for (const tr of c.querySelectorAll('tr')) {
            const cells = [...tr.children].map((td) => squash(td.textContent).trim()).filter(Boolean);
            if (cells.length) push({ t: 'p', r: [[cells.join('  |  ')]] });
          }
        } else if (BLOCK_TAGS.has(tag)) {
          // A container: if it holds only inline content, it's a paragraph; otherwise look inside.
          const hasBlocks = [...c.children].some((k) => BLOCK_TAGS.has(k.tagName.toLowerCase()));
          if (hasBlocks) walk(c);
          else para(c, 'p');
        } else {
          para(c, 'p');
        }
      }
    })(root);
    return out;
  }

  /** The built-in finder: the element holding the most paragraph text. */
  function findArticle(doc) {
    for (const el of doc.querySelectorAll(SKIP + ',header')) el.remove();
    const direct = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role=main]');
    if (direct && (direct.textContent || '').trim().length > 400) return direct;
    let best = doc.body, bestScore = 0;
    for (const el of doc.querySelectorAll('div, section')) {
      let score = 0;
      for (const p of el.querySelectorAll(':scope > p')) score += (p.textContent || '').length;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore > 200 ? best : doc.body;
  }

  /** html + its address -> { url, title, blocks } */
  function toArticle(html, url) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const meta = (sel) => { const m = doc.querySelector(sel); return m ? squash(m.getAttribute('content')).trim() : ''; };
    let title = meta('meta[property="og:title"]') || squash(doc.title).trim();
    let site = meta('meta[property="og:site_name"]');
    let byline = meta('meta[name="author"]');
    let root = null;

    if (typeof window !== 'undefined' && typeof window.Readability === 'function') {
      try {
        const art = new window.Readability(doc.cloneNode(true), { charThreshold: 300, keepClasses: false }).parse();
        if (art && art.content && (art.textContent || '').trim().length > 200) {
          root = parser.parseFromString('<div>' + art.content + '</div>', 'text/html').body;
          title = squash(art.title).trim() || title;
          byline = squash(art.byline).trim() || byline;
          site = squash(art.siteName).trim() || site;
        }
      } catch (e) { console.warn('Readability', e); }
    }
    if (!root) root = findArticle(doc);

    let blocks = blocksOf(root, url, title);
    if (!blocks.some((b) => b.t === 'p' || b.t === 'li')) {
      // Nothing that looks like an article: fall back to all the text on the page.
      const text = squash(root ? root.textContent : doc.body ? doc.body.textContent : '').trim();
      blocks = text ? [{ t: 'p', r: [[text.slice(0, 20000)]] }] : [];
    }
    const head = [];
    if (title) head.push({ t: 'h1', r: [[title]] });
    const mins = WT.reader.readingMinutes(blocks);
    const metaLine = [byline, site, blocks.length ? mins + ' min read' : ''].filter(Boolean).join(' · ');
    if (metaLine) head.push({ t: 'meta', r: [[metaLine]] });
    if (!blocks.length) blocks = [{ t: 'p', r: [['There’s nothing to read on this page in reading mode. Try opening it in your browser (the arrow at the top right).']] }];
    return { url, title: title || url, blocks: head.concat(blocks) };
  }

  WT.extract = { toArticle, resolve };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
