/* page.js — injected into the tab. Must stay self-contained (no closures). */
/* eslint-disable no-undef */
function pageExec(p) {
  const W = window;
  const D = document;
  if (!W.__bx) W.__bx = { refs: {}, n: 0 };
  const S = W.__bx;
  const res = (o) => o;

  const SEL = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]',
    '[role=tab]', '[role=menuitem]', '[role=option]', '[role=switch]',
    '[contenteditable=""]', '[contenteditable="true"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function vis(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return false;
    return true;
  }

  function depth(el) {
    let d = 0;
    let n = el;
    while (n && n.parentElement) { d++; n = n.parentElement; }
    return d;
  }

  function textOf(el) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t;
    const cand = el.getAttribute('aria-label') || el.getAttribute('title') ||
      el.getAttribute('placeholder') || el.getAttribute('alt') ||
      el.getAttribute('name') || el.value || '';
    return String(cand).replace(/\s+/g, ' ').trim();
  }

  function box(el) {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  }

  function ref(el) {
    for (const k in S.refs) if (S.refs[k] === el) return k;
    const k = 'e' + (++S.n);
    S.refs[k] = el;
    return k;
  }

  function desc(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const o = {
      ref: ref(el),
      tag: el.tagName.toLowerCase(),
      text: textOf(el).slice(0, 160),
      box: box(el),
      onScreen: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    };
    if (el.type) o.type = el.type;
    if (el.name) o.name = el.name;
    if (el.id) o.id = el.id;
    const href = el.getAttribute && el.getAttribute('href');
    if (href) o.href = href.slice(0, 300);
    if (el.getAttribute && el.getAttribute('placeholder')) o.ph = el.getAttribute('placeholder');
    if (el.getAttribute && el.getAttribute('aria-label')) o.al = el.getAttribute('aria-label');
    if ('value' in el && el.tagName !== 'BUTTON' && el.tagName !== 'A') o.value = String(el.value).slice(0, 120);
    if (el.type === 'checkbox' || el.type === 'radio') {
      o.checked = !!el.checked;
      const lab = (el.labels && el.labels[0]) || el.closest('label');
      if (lab) o.label = textOf(lab).slice(0, 80);
    }
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.labels && el.labels[0]) {
      o.label = textOf(el.labels[0]).slice(0, 80);
    }
    if (el.disabled) o.disabled = true;
    if (el.tagName === 'SELECT') o.options = Array.from(el.options).slice(0, 40).map((o2) => String(o2.text).slice(0, 60));
    return o;
  }

  function interactive(max) {
    const all = Array.from(D.querySelectorAll(SEL)).filter(vis);
    const scored = all.map((el) => {
      const d = depth(el);
      let s = 0;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') s = 100;
      else if (el.tagName === 'BUTTON' || el.tagName === 'A') s = 80;
      else if (el.getAttribute('role')) s = 60;
      else s = 30;
      if (el.getAttribute('aria-hidden') === 'true') s = -1;
      return { el, s, d };
    }).filter((x) => x.s > 0);
    scored.sort((a, b) => a.d - b.d);
    const out = [];
    for (const x of scored) {
      if (out.length >= max) break;
      // skip elements fully wrapped by an already-listed parent link/button
      if (out.some((o) => o.contains && o !== x.el && o.contains(x.el) && (o.tagName === 'BUTTON' || o.tagName === 'A'))) continue;
      out.push(x.el);
    }
    return out;
  }

  function resolve(t) {
    if (!t) return null;
    t = String(t).trim();
    if (S.refs[t] && S.refs[t].isConnected) return S.refs[t];
    if (t.startsWith('#')) { try { const e = D.querySelector(t); if (e) return e; } catch (e) {} }
    try { const e = D.querySelector(t); if (e) return e; } catch (e) {}
    const q = t.toLowerCase();
    const cands = Array.from(D.querySelectorAll(SEL + ',label,li,td,h1,h2,h3,h4,span,div'))
      .filter(vis).slice(0, 6000);
    let best = null;
    let bestScore = -1;
    for (const el of cands) {
      const txt = textOf(el).toLowerCase();
      if (!txt || txt.length > 400) continue;
      let s = 0;
      if (txt === q) s = 100;
      else if (txt.startsWith(q)) s = 82;
      else if (txt.includes(q)) s = 60 - Math.min(25, Math.floor(txt.length / 30));
      if (s <= 0) continue;
      s -= Math.min(12, Math.floor(depth(el) / 4));
      if (s > bestScore) { bestScore = s; best = el; }
    }
    return bestScore > 20 ? best : null;
  }

  function fire(el, types) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: W };
    for (const [t, Ctor] of types) {
      try {
        const ev = Ctor === 'PointerEvent' ? new PointerEvent(t, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 })
          : Ctor === 'MouseEvent' ? new MouseEvent(t, { ...base, button: 0 })
            : new Event(t, base);
        el.dispatchEvent(ev);
      } catch (e) {}
    }
  }

  function scrollTo(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {
      try { el.scrollIntoView(); } catch (e2) {}
    }
  }

  function flash(el) {
    try {
      const r = el.getBoundingClientRect();
      const d = D.createElement('div');
      d.style.cssText = `position:fixed;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;
        border:2px solid #ff3b6b;border-radius:4px;z-index:2147483647;pointer-events:none;transition:opacity .35s`;
      D.documentElement.appendChild(d);
      setTimeout(() => { d.style.opacity = '0'; }, 320);
      setTimeout(() => d.remove(), 760);
    } catch (e) {}
  }

  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'INPUT' ? HTMLInputElement.prototype
        : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : null;
    const d = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function keyEv(el, type, key, extra) {
    const ev = new KeyboardEvent(type, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...extra });
    el.dispatchEvent(ev);
  }

  switch (p.op) {
    case 'info':
      return res({
        url: location.href,
        title: D.title,
        scrollY: Math.round(W.scrollY),
        scrollH: D.documentElement.scrollHeight,
        viewport: [innerWidth, innerHeight],
        ready: D.readyState,
        selection: String(W.getSelection ? W.getSelection() : '').slice(0, 400),
      });

    case 'digest': {
      const maxText = p.maxText || 5000;
      const maxEls = p.maxEls || 120;
      const body = D.body ? (D.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim() : '';
      const els = interactive(maxEls).map(desc);
      const heads = Array.from(D.querySelectorAll('h1,h2,h3')).filter(vis).slice(0, 25).map((h) => h.tagName.toLowerCase() + ': ' + textOf(h).slice(0, 120));
      const forms = Array.from(D.querySelectorAll('form')).slice(0, 8).map((f) => ({
        action: f.getAttribute('action') || '',
        method: (f.getAttribute('method') || 'get').toUpperCase(),
        fields: Array.from(f.querySelectorAll('input,select,textarea,button')).filter(vis).slice(0, 30).map(desc),
      }));
      return res({
        url: location.href,
        title: D.title,
        text: body.slice(0, maxText),
        textTruncated: body.length > maxText,
        textLength: body.length,
        headings: heads,
        elements: els,
        elementCount: D.querySelectorAll(SEL).length,
        forms,
      });
    }

    case 'find': {
      const q = String(p.query || '').toLowerCase();
      const cands = Array.from(D.querySelectorAll(SEL + ',label,li,td,h1,h2,h3,h4')).filter(vis);
      const hits = [];
      for (const el of cands) {
        const t = textOf(el);
        if (!t || t.length > 400) continue;
        if (!t.toLowerCase().includes(q)) continue;
        hits.push(desc(el));
        if (hits.length >= (p.max || 40)) break;
      }
      return res({ query: p.query, count: hits.length, hits });
    }

    case 'click': {
      const el = resolve(p.target);
      if (!el) return res({ error: `no element matched "${p.target}"` });
      scrollTo(el);
      if (p.highlight) flash(el);
      const before = location.href;
      fire(el, [['pointerover', 'PointerEvent'], ['mouseover', 'MouseEvent'], ['pointerdown', 'PointerEvent'], ['mousedown', 'MouseEvent'], ['pointerup', 'PointerEvent'], ['mouseup', 'MouseEvent']]);
      if (p.dbl) {
        fire(el, [['click', 'MouseEvent'], ['click', 'MouseEvent'], ['dblclick', 'MouseEvent']]);
      } else if (typeof el.click === 'function') {
        el.click();
      } else {
        fire(el, [['click', 'MouseEvent']]);
      }
      return res({ clicked: desc(el), navigated: location.href !== before });
    }

    case 'hover': {
      const el = resolve(p.target);
      if (!el) return res({ error: `no element matched "${p.target}"` });
      scrollTo(el);
      fire(el, [['pointerover', 'PointerEvent'], ['mouseover', 'MouseEvent'], ['pointermove', 'PointerEvent'], ['mousemove', 'MouseEvent']]);
      return res({ hovered: desc(el) });
    }

    case 'type': {
      let el = p.target ? resolve(p.target) : D.activeElement;
      if (!el) return res({ error: 'no target and nothing focused' });
      scrollTo(el);
      try { el.focus(); } catch (e) {}
      if (p.clear) {
        if (el.isContentEditable) el.textContent = '';
        else setVal(el, '');
      }
      if (el.isContentEditable) {
        try { D.execCommand('insertText', false, p.text); } catch (e) { el.textContent = p.text; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        setVal(el, p.clear ? p.text : String(el.value || '') + p.text);
      }
      if (p.submit) {
        keyEv(el, 'keydown', 'Enter');
        keyEv(el, 'keypress', 'Enter');
        keyEv(el, 'keyup', 'Enter');
        const form = el.form || el.closest('form');
        if (form && typeof form.requestSubmit === 'function') { try { form.requestSubmit(); } catch (e) {} }
      }
      return res({ typed: p.text.length, into: desc(el), submitted: !!p.submit });
    }

    case 'keys': {
      // char-by-char, closest to a human typing; survives React/keystroke filters
      const el = p.target ? resolve(p.target) : D.activeElement;
      if (!el) return res({ error: 'no target and nothing focused' });
      try { el.focus(); } catch (e) {}
      const text = String(p.text || '');
      for (const ch of text) {
        keyEv(el, 'keydown', ch);
        keyEv(el, 'keypress', ch);
        if (el.isContentEditable) { try { D.execCommand('insertText', false, ch); } catch (e) {} }
        else setVal(el, String(el.value || '') + ch);
        keyEv(el, 'keyup', ch);
        if (p.delay) { const t0 = Date.now(); while (Date.now() - t0 < p.delay) {} }
      }
      return res({ typed: text.length, into: desc(el) });
    }

    case 'press': {
      const el = p.target ? resolve(p.target) : D.activeElement || D.body;
      const key = p.key || 'Enter';
      const parts = key.split('+');
      const main = parts.pop();
      const mods = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
      for (const m of parts) {
        const k = m.toLowerCase();
        if (k === 'control' || k === 'ctrl') mods.ctrlKey = true;
        else if (k === 'shift') mods.shiftKey = true;
        else if (k === 'alt') mods.altKey = true;
        else if (k === 'meta' || k === 'cmd' || k === 'command') mods.metaKey = true;
      }
      keyEv(el, 'keydown', main, mods);
      keyEv(el, 'keypress', main, mods);
      keyEv(el, 'keyup', main, mods);
      if (main === 'Enter' && el.form) { try { el.form.requestSubmit(); } catch (e) {} }
      return res({ pressed: key, on: desc(el) });
    }

    case 'select': {
      const el = resolve(p.target);
      if (!el || el.tagName !== 'SELECT') return res({ error: 'target is not a <select>' });
      const opt = Array.from(el.options).find((o) => o.value === p.value || String(o.text).trim() === String(p.value).trim());
      if (!opt) return res({ error: 'no such option', options: Array.from(el.options).map((o) => o.text) });
      setVal(el, opt.value);
      return res({ selected: opt.text, value: opt.value });
    }

    case 'check': {
      const el = resolve(p.target);
      if (!el) return res({ error: `no element matched "${p.target}"` });
      if (!!el.checked !== !!p.on) el.click();
      return res({ checked: !!el.checked, el: desc(el) });
    }

    case 'scroll': {
      if (p.into) {
        const el = resolve(p.into);
        if (!el) return res({ error: `no element matched "${p.into}"` });
        scrollTo(el);
      } else if (p.to === 'top') W.scrollTo(0, 0);
      else if (p.to === 'bottom') W.scrollTo(0, D.documentElement.scrollHeight);
      else if (p.to !== undefined && p.to !== null && p.to !== '') W.scrollTo(0, Number(p.to));
      else W.scrollBy(0, Number(p.by || 600));
      return res({ scrollY: Math.round(W.scrollY), scrollH: D.documentElement.scrollHeight });
    }

    case 'text': {
      const el = resolve(p.target);
      if (!el) return res({ error: `no element matched "${p.target}"` });
      return res({ target: desc(el), text: (el.innerText || el.textContent || '').trim().slice(0, 4000) });
    }

    case 'eval': {
      try {
        const fn = new Function('"use strict";return (' + p.code + ')');
        const v = fn();
        let out;
        try { out = JSON.parse(JSON.stringify(v)); } catch (e) { out = String(v); }
        return res({ value: out, type: typeof v });
      } catch (e) {
        return res({ error: String(e && e.message || e) });
      }
    }

    case 'chat': {
      // The panel is an iframe on moz-extension://, not page DOM: keys typed in
      // it never reach the page (games bind space, arrows, letters and steal
      // focus), and the page's CSS cannot reach it either.
      const CHAT_VER = '5';
      const stale = D.getElementById('bxchat-host');
      if (stale && stale.dataset.bxver === CHAT_VER) return res({ mounted: true, already: true });
      if (stale) { try { stale.remove(); } catch (e) {} }

      const host = D.createElement('div');
      host.id = 'bxchat-host';
      host.dataset.bxver = CHAT_VER;
      host.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px',
        'width:330px', 'height:430px', 'z-index:2147483647',
        'margin:0', 'padding:0', 'border:0', 'background:transparent',
        'display:block', 'pointer-events:auto',
        'filter:drop-shadow(0 12px 34px rgba(30,20,0,.28))',
      ].join(';') + ';';

      const frame = D.createElement('iframe');
      frame.src = browser.runtime.getURL('chat-frame.html');
      frame.setAttribute('allowtransparency', 'true');
      frame.setAttribute('title', 'free-pi chat');
      frame.style.cssText = 'width:100%;height:100%;border:0;margin:0;padding:0;background:transparent;color-scheme:light;display:block;';
      host.appendChild(frame);
      D.documentElement.appendChild(host);

      const W = D.defaultView || window;
      const sizeFor = (max) => max
        ? { w: Math.min(Math.round(W.innerWidth * 0.78), 980), h: Math.min(Math.round(W.innerHeight * 0.82), 760) }
        : { w: 330, h: 430 };
      const applySize = (max) => {
        const s = sizeFor(max);
        host.style.width = s.w + 'px';
        host.style.height = s.h + 'px';
      };

      let maximized = false;
      const onMsg = (ev) => {
        // content-script windows are Xray wrappers, so comparing ev.source is
        // unreliable; accept only the two ops this frame is allowed to ask for.
        const d = ev.data && ev.data.bx;                 // frame sends { bx: { op } }
        if (!d || typeof d !== 'object') return;
        if (d.op !== 'chat-close' && d.op !== 'chat-max') return;
        if (d.op === 'chat-max') {
          maximized = !!d.on;
          applySize(maximized);
          try { browser.runtime.sendMessage({ type: 'chat-pref-set', chatMax: maximized }); } catch (e) {}
        }
        if (d.op === 'chat-close') {
          try { browser.runtime.sendMessage({ type: 'chat-hide-tab' }); } catch (e) {}
          remove();
        }
      };
      const onResize = () => { if (maximized) applySize(true); };
      const remove = () => {
        try { W.removeEventListener('message', onMsg); } catch (e) {}
        try { W.removeEventListener('resize', onResize); } catch (e) {}
        try { host.remove(); } catch (e) {}
      };
      W.addEventListener('message', onMsg);
      W.addEventListener('resize', onResize);

      frame.addEventListener('load', () => {
        try { frame.contentWindow.postMessage({ bxFocus: true }, '*'); } catch (e) {}
      });
      (async () => {
        try {
          const p2 = await browser.runtime.sendMessage({ type: 'chat-pref-get' });
          if (p2 && p2.ok && p2.chatMax) { maximized = true; applySize(true); }
        } catch (e) {}
      })();
      return res({ mounted: true, frame: true });
    }

    case 'chat-close': {
      const h = D.getElementById('bxchat-host');
      if (h) h.remove();
      return res({ closed: !!h });
    }

    default:
      return res({ error: 'unknown page op ' + p.op });
  }
}
