(async function () {
  const $ = (s) => document.getElementById(s);
  const slug = decodeURIComponent(location.pathname.split('/').pop());
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Danish locale, forced 24-hour clock, browser's timezone.
  const dayFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }); // YYYY-MM-DD local

  function notFound(msg) {
    const p = $('status-text'); p.textContent = msg + ' ';
    const a = document.createElement('a'); a.href = '/'; a.textContent = 'Opret en ny'; p.appendChild(a);
  }
  try {
    const res = await fetch('/api/events/' + encodeURIComponent(slug));
    if (res.status === 404) return notFound('Afstemningen findes ikke.');
    if (!res.ok) throw new Error();
    const ev = await res.json();
    // All user content via textContent/value (no HTML injection).
    $('t').textContent = ev.title;
    $('d').textContent = ev.description; $('d').hidden = !ev.description;
    $('tz').textContent = tz;
    const url = location.origin + '/p/' + ev.id;
    $('url').value = url;
    $('count').textContent = '(' + ev.time_options.length + ')';

    const groups = new Map(); // server sorts by UTC start; local grouping keeps that order
    ev.time_options.forEach((o) => {
      const s = new Date(o.start_at), e = o.end_at ? new Date(o.end_at) : null;
      const k = keyFmt.format(s);
      if (!groups.has(k)) groups.set(k, { date: s, items: [] });
      let label = timeFmt.format(s);
      if (e) label += ' – ' + (keyFmt.format(e) === k ? timeFmt.format(e) : dayFmt.format(e) + ' ' + timeFmt.format(e));
      groups.get(k).items.push({ label, iso: o.start_at });
    });
    const days = $('days');
    groups.forEach((g) => {
      const sec = document.createElement('section'); sec.className = 'poll-day';
      const h = document.createElement('h3'); h.className = 'poll-day__title'; h.textContent = dayFmt.format(g.date);
      const ul = document.createElement('ul'); ul.className = 'chips';
      g.items.forEach((it) => {
        const li = document.createElement('li'); li.className = 'chip';
        const t = document.createElement('time'); t.dateTime = it.iso; t.textContent = it.label;
        li.appendChild(t); ul.appendChild(li);
      });
      sec.append(h, ul); days.appendChild(sec);
    });

    const copy = $('copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); }
      catch { $('url').select(); document.execCommand && document.execCommand('copy'); }
      copy.textContent = '✓ Kopieret'; copy.classList.add('btn--copied'); $('live').textContent = 'Link kopieret';
      setTimeout(() => { copy.textContent = 'Kopiér'; copy.classList.remove('btn--copied'); $('live').textContent = ''; }, 2000);
    });
    $('status').hidden = true; $('poll').hidden = false;
  } catch {
    $('status-text').textContent = 'Der opstod en fejl. Prøv igen senere.';
  }
})();
