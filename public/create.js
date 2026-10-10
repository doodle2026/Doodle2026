(function () {
  const $ = (id) => document.getElementById(id);
  const form = $('form'), list = $('proposals'), live = $('live'), submitBtn = $('submit');
  const dateTpl = $('date-group-tpl'), slotTpl = $('slot-tpl');
  const dayFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmt = (d) => dayFmt.format(new Date(d + 'T12:00'));
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  let requestKey = newKey(), submitting = false;

  $('tz').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const announce = (t) => { live.textContent = t; };
  const refresh = () => { $('empty').hidden = list.children.length > 0; };
  const removeAnim = (el, cb) => { el.classList.add('anim-out'); setTimeout(() => { el.remove(); cb && cb(); refresh(); requestKey = newKey(); }, 180); };

  function slot(s = '', e = '') {
    const li = slotTpl.content.firstElementChild.cloneNode(true);
    li.querySelector('.js-start').value = s; li.querySelector('.js-end').value = e;
    li.querySelector('.js-remove-slot').addEventListener('click', () => {
      const g = li.closest('.date-group');
      removeAnim(li, () => { if (!g.querySelector('.slot')) removeAnim(g); });
      announce('Tidspunkt fjernet');
    });
    return li;
  }
  function addDate(d, slots = [['', '']]) {
    if (list.querySelector(`[data-date="${CSS.escape(d)}"]`)) { $('prop-err').textContent = 'Datoen er allerede tilføjet.'; return; }
    $('prop-err').textContent = '';
    const g = dateTpl.content.firstElementChild.cloneNode(true);
    g.dataset.date = d;
    g.querySelector('.date-group__title').textContent = fmt(d);
    const rm = g.querySelector('.js-remove-date');
    rm.setAttribute('aria-label', 'Fjern dato ' + fmt(d));
    rm.addEventListener('click', () => { removeAnim(g); announce('Dato fjernet'); });
    const ul = g.querySelector('.slots');
    slots.forEach((s) => ul.append(slot(...s)));
    g.querySelector('.js-add-slot').addEventListener('click', () => { const n = slot(); ul.append(n); n.querySelector('input').focus(); });
    const after = [...list.children].find((x) => x.dataset.date > d);
    list.insertBefore(g, after || null);
    refresh(); announce('Dato tilføjet: ' + fmt(d));
    g.querySelector('.js-start').focus();
  }
  $('adddate').addEventListener('click', () => {
    const v = $('newdate').value;
    if (!v) { $('prop-err').textContent = 'Vælg en dato først.'; $('newdate').focus(); return; }
    addDate(v);
  });
  form.addEventListener('input', () => { if (!submitting) requestKey = newKey(); });
  form.addEventListener('reset', () => { setTimeout(() => { list.textContent = ''; showSummary([]); refresh(); requestKey = newKey(); }); });

  function showSummary(errs) {
    const box = $('summary'); box.textContent = '';
    if (!errs.length) return;
    const strong = document.createElement('strong'); strong.textContent = 'Ret venligst følgende:';
    const ul = document.createElement('ul');
    errs.forEach((x) => { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
    box.append(strong, ul);
  }
  // Local wall-clock date+time in the browser's timezone → UTC ISO string.
  const toIso = (date, time) => new Date(date + 'T' + time).toISOString();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const errs = [], t = $('title');
    document.querySelectorAll('.slot--dup').forEach((x) => x.classList.remove('slot--dup'));
    if (!t.value.trim()) { errs.push('Titel skal udfyldes.'); t.setAttribute('aria-invalid', 'true'); $('title-err').textContent = 'Giv afstemningen en titel.'; }
    else { t.removeAttribute('aria-invalid'); $('title-err').textContent = ''; }
    const opts = [], seen = {}; let dup = false, missing = false, order = false, past = false;
    const now = Date.now();
    list.querySelectorAll('.slot').forEach((s) => {
      const a = s.querySelector('.js-start'), b = s.querySelector('.js-end');
      const d = s.closest('.date-group').dataset.date;
      if (!a.value) { missing = true; a.setAttribute('aria-invalid', 'true'); return; }
      a.removeAttribute('aria-invalid');
      if (b.value && b.value <= a.value) { order = true; b.setAttribute('aria-invalid', 'true'); } else b.removeAttribute('aria-invalid');
      const start = toIso(d, a.value);
      if (Date.parse(start) < now) { past = true; a.setAttribute('aria-invalid', 'true'); }
      const k = d + a.value + (b.value || '');
      if (seen[k]) { dup = true; s.classList.add('slot--dup'); seen[k].classList.add('slot--dup'); }
      seen[k] = s;
      opts.push({ start, end: b.value ? toIso(d, b.value) : null });
    });
    if (!opts.length && !missing) errs.push('Tilføj mindst ét tidsforslag.');
    if (missing) errs.push('Udfyld starttid for alle tidspunkter.');
    if (order) errs.push('Sluttid skal være efter starttid.');
    if (past) errs.push('Tidspunkter må ikke ligge i fortiden.');
    if (dup) errs.push('Der er dubletter blandt tidsforslagene.');
    $('prop-err').textContent = errs.filter((x) => x !== 'Titel skal udfyldes.').join(' ');
    showSummary(errs);
    if (errs.length) { (t.getAttribute('aria-invalid') ? t : (list.querySelector('[aria-invalid=true]') || $('newdate'))).focus(); return; }

    submitting = true; submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
        body: JSON.stringify({ title: t.value, description: $('desc').value, time_options: opts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw (data.errors || ['Ukendt fejl.']);
      location.assign(data.url);
      return; // keep button disabled while navigating
    } catch (err) {
      showSummary(Array.isArray(err) ? err : ['Kunne ikke kontakte serveren. Prøv igen.']);
    }
    submitting = false; submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy');
  });
  refresh();
})();
