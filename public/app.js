(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || 'Request failed'), { fields: body.fields, status: res.status });
    return body;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 && h < 24 ? 'pm' : 'am'}`; };
  const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#year').textContent = new Date().getFullYear();

  // ---------- Photos: images/<name>.jpg|jpeg|png|webp replaces the grey placeholder ----------
  const EXTS = ['jpg', 'jpeg', 'png', 'webp'];
  function applyPhotos(root = document) {
    $$('.ph[data-img]', root).forEach((ph) => {
      const tryExt = (i) => {
        if (i >= EXTS.length) return;
        const img = new Image();
        img.alt = ph.getAttribute('aria-label') || '';
        img.onload = () => { ph.replaceChildren(img); ph.classList.add('loaded'); if (ph.dataset.img.startsWith('gallery')) { ph.tabIndex = 0; ph.setAttribute('role', 'button'); } updateParallax(); };
        img.onerror = () => tryExt(i + 1);
        img.src = `images/${ph.dataset.img}.${EXTS[i]}`;
      };
      tryExt(0);
    });
  }

  // ---------- Scroll reveal ----------
  const io = 'IntersectionObserver' in window && !reduce
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    : null;
  const watch = (n) => (io ? io.observe(n) : n.classList.add('in'));
  $$('.reveal,.reveal-img').forEach(watch);

  // ---------- Count-up numbers ----------
  const counter = (node) => {
    const target = parseFloat(node.dataset.count), dec = Number(node.dataset.dec || 0), suf = node.dataset.suffix || '';
    if (reduce) return;
    const t0 = performance.now(), dur = 1500;
    const tick = (t) => {
      const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      node.textContent = (target * e).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    const co = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { counter(e.target); co.unobserve(e.target); } }), { threshold: 0.6 });
    $$('[data-count]').forEach((n) => co.observe(n));
  }

  // ---------- Nav, progress bar, parallax, mobile CTA ----------
  const nav = $('.nav'), bar = $('.progress'), mcta = $('.m-cta');
  let visitVisible = false, ticking = false;
  function updateParallax() {
    if (reduce) return;
    $$('.ph[data-parallax]').forEach((ph) => {
      const r = ph.getBoundingClientRect();
      if (r.bottom < -100 || r.top > innerHeight + 100) return;
      const lim = r.height * 0.06, off = (r.top + r.height / 2 - innerHeight / 2) * -0.07;
      ph.style.setProperty('--py', Math.max(-lim, Math.min(lim, off)).toFixed(1) + 'px');
    });
  }
  function onScroll() {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    nav.classList.toggle('scrolled', y > 24);
    bar.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
    mcta.classList.toggle('show', y > innerHeight * 0.7 && !visitVisible);
    updateParallax(); ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', () => { onScroll(); moveInd(); });
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visitVisible = es[0].isIntersecting; onScroll(); }).observe($('#visit'));

  const toggle = $('.nav-toggle'), links = $('#nav-links');
  const closeNav = () => { links.classList.remove('open'); nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Open menu'); };
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open'); nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open); toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  links.addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });

  // ---------- Open now badge (uses the same hours as the server) ----------
  (async () => {
    try {
      const { hours } = await api('/api/hours');
      const now = new Date(), day = now.getDay(), cur = now.getHours() + now.getMinutes() / 60;
      const hh = (h) => { const x = h % 24; return `${x % 12 || 12} ${x >= 12 ? 'pm' : 'am'}`; };
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const badge = $('#open-badge'), title = $('#open-title'), sub = $('#open-sub');
      const today = hours[day];
      if (today && cur >= today[0] && cur < today[1]) {
        badge.classList.add('live'); title.textContent = 'Open now'; sub.textContent = `Serving until ${hh(today[1])}`;
      } else {
        for (let d = 0; d < 8; d++) {
          const dd = (day + d) % 7, hr = hours[dd];
          if (hr && (d > 0 || cur < hr[0])) { title.textContent = 'Closed right now'; sub.textContent = `Opens ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : names[dd]} at ${hh(hr[0])}`; break; }
        }
      }
      badge.hidden = false;
    } catch { /* badge simply stays hidden */ }
  })();

  // ---------- Menu ----------
  const tabs = $('#menu-tabs'), ind = el('span', 'tab-ind');
  function moveInd() {
    const sel = $('.tab[aria-selected=true]', tabs);
    if (!sel) return;
    ind.style.width = sel.offsetWidth + 'px'; ind.style.transform = `translateX(${sel.offsetLeft}px)`;
  }
  (async () => {
    const cards = $('#menu-cards');
    try {
      const items = await api('/api/menu');
      const cats = [...new Set(items.map((i) => i.category))];
      let current = cats.includes('Mains') ? 'Mains' : cats[0], first = true;
      const render = () => {
        const nodes = items.filter((i) => i.category === current).map((i, idx) => {
          const c = el('article', first ? 'card reveal' : 'card pop'); c.style.setProperty(first ? '--d' : '--i', first ? idx * 0.12 + 's' : idx);
          const ph = el('div', 'ph'); ph.dataset.img = 'dish-' + i.id; ph.setAttribute('role', 'img'); ph.setAttribute('aria-label', i.name); ph.append(el('span', '', 'Image: ' + i.name));
          const body = el('div', 'card-body'), row = el('div', 'card-title');
          row.append(el('h3', '', i.name), el('span', 'price', '$' + i.price));
          body.append(row, el('p', '', i.description));
          c.append(ph, body); return c;
        });
        cards.replaceChildren(...nodes); applyPhotos(cards);
        if (first) $$('.reveal', cards).forEach(watch);
        first = false;
        $$('.tab', tabs).forEach((t) => t.setAttribute('aria-selected', t.textContent === current));
        moveInd();
      };
      tabs.replaceChildren(ind, ...cats.map((c) => {
        const b = el('button', 'tab', c); b.type = 'button'; b.setAttribute('role', 'tab');
        b.addEventListener('click', () => { if (current !== c) { current = c; render(); } }); return b;
      }));
      render();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInd);
    } catch { cards.replaceChildren(el('p', 'muted', 'The menu could not be loaded. Please refresh the page.')); }
  })();

  // ---------- Reviews ----------
  (async () => {
    const box = $('#review-cards');
    try {
      const list = await api('/api/reviews');
      box.replaceChildren(...list.map((r, i) => {
        const c = el('article', 'card review reveal'); c.style.setProperty('--d', i * 0.12 + 's');
        const stars = el('div', 'stars', '★'.repeat(r.rating)); stars.setAttribute('aria-label', `${r.rating} out of 5 stars`);
        const f = el('footer'); f.append(el('strong', '', r.name), el('span', '', r.context));
        const top = el('div'); top.append(el('div', 'qmark', '“'), stars);
        c.append(top, el('blockquote', '', r.text), f); watch(c); return c;
      }));
    } catch { box.replaceChildren(); }
  })();

  // ---------- Gallery lightbox ----------
  const lb = el('div', 'lb'), lbImg = el('img'), lbClose = el('button', 'lb-close', '×');
  lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Photo viewer'); lbClose.setAttribute('aria-label', 'Close photo');
  lb.append(lbImg, lbClose); document.body.append(lb);
  let lastFocus = null;
  const openLb = (img) => { lastFocus = document.activeElement; lbImg.src = img.src; lbImg.alt = img.alt; lb.classList.add('open'); document.body.style.overflow = 'hidden'; lbClose.focus(); };
  const closeLb = () => { lb.classList.remove('open'); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); };
  const gallery = $('.gallery');
  gallery.addEventListener('click', (e) => { const ph = e.target.closest('.ph.loaded'); if (ph) openLb($('img', ph)); });
  gallery.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const ph = e.target.closest('.ph.loaded'); if (ph) { e.preventDefault(); openLb($('img', ph)); } } });
  lb.addEventListener('click', (e) => { if (e.target !== lbImg) closeLb(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('open')) closeLb(); });

  // ---------- Reservation form ----------
  const form = $('#booking'), msg = $('#form-msg');
  const dateIn = form.date, timeIn = form.time, guestsIn = form.guests;
  const d = new Date(); dateIn.min = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  for (let i = 1; i <= 12; i++) guestsIn.append(new Option(i === 1 ? '1 guest' : `${i} guests`, i, false, i === 2));
  const setErr = (name, text) => {
    const small = $(`.err[data-for="${name}"]`, form), input = form[name];
    if (small) small.textContent = text || '';
    if (input) text ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');
  };
  const clearErrs = () => ['name', 'email', 'date', 'guests', 'time'].forEach((n) => setErr(n));

  let availToken = 0;
  async function loadSlots() {
    const date = dateIn.value; if (!date) return;
    const token = ++availToken, previous = timeIn.value;
    timeIn.disabled = true; timeIn.replaceChildren(new Option('Checking availability…', ''));
    try {
      const a = await api(`/api/availability?date=${encodeURIComponent(date)}&guests=${guestsIn.value}`);
      if (token !== availToken) return;
      const open = a.slots.filter((s) => s.available);
      if (a.closed) timeIn.replaceChildren(new Option('Closed on this day', ''));
      else if (!open.length) timeIn.replaceChildren(new Option('Fully booked. Try another date.', ''));
      else {
        timeIn.replaceChildren(new Option('Choose a time', ''), ...open.map((s) => new Option(fmtTime(s.time), s.time)));
        if (open.some((s) => s.time === previous)) timeIn.value = previous;
        timeIn.disabled = false;
      }
    } catch (e) { if (token === availToken) timeIn.replaceChildren(new Option(e.message, '')); }
  }
  dateIn.addEventListener('change', () => { setErr('date'); loadSlots(); });
  guestsIn.addEventListener('change', loadSlots);

  const CHECK = '<svg class="check" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26.5"/><path d="M17 29.5l7.5 7.5L39 20"/></svg>';
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrs(); msg.className = 'form-msg'; msg.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    const local = {};
    if (data.name.trim().length < 2) local.name = 'Enter your full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) local.email = 'Enter a valid email address.';
    if (!data.date) local.date = 'Choose a date.';
    if (data.date && !data.time) local.time = 'Choose a time.';
    if (Object.keys(local).length) { Object.entries(local).forEach(([k, v]) => setErr(k, v)); form[Object.keys(local)[0]].focus(); return; }

    const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Confirming…';
    try {
      const r = await api('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const box = el('div', 'confirm'); box.setAttribute('tabindex', '-1');
      box.insertAdjacentHTML('afterbegin', CHECK);
      const strong = el('strong', '', 'Table confirmed');
      const p = el('p', 'muted', `${r.name}, we have you down for ${r.guests} ${r.guests === 1 ? 'guest' : 'guests'} on ${fmtDate(r.date)} at ${fmtTime(r.time)}.`);
      const code = el('span', 'code', r.code);
      const small = el('p', 'muted', r.emailed ? `We have emailed your confirmation to ${r.email}. If you cannot see it, please check your spam folder.` : 'Show this code if you need to change or cancel your booking.'); small.style.fontSize = '14px';
      box.append(strong, p, code, small);
      form.replaceChildren(box); box.focus({ preventScroll: true });
    } catch (err) {
      msg.className = 'form-msg bad'; msg.textContent = err.message;
      if (err.fields) { Object.entries(err.fields).forEach(([k, v]) => setErr(k, v)); if (err.status === 409) loadSlots(); }
      btn.disabled = false; btn.innerHTML = 'Confirm reservation <span class="arr">→</span>';
    }
  });

  applyPhotos();
  onScroll();
})();
