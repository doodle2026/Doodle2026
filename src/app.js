const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateEvent, SLUG_RE, IDEMPOTENCY_RE } = require('./validate');

const PUB = path.join(__dirname, '..', 'public');
const escapeHtml = (s) => String(s).replace(/[&<>"'`]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

function createApp(db, { now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    next();
  });

  const q = {
    insertEvent: db.prepare('INSERT INTO events (slug, title, description, created_at) VALUES (?, ?, ?, ?)'),
    insertOpt: db.prepare('INSERT INTO time_options (event_id, start_at, end_at, position) VALUES (?, ?, ?, ?)'),
    insertKey: db.prepare('INSERT INTO idempotency_keys (key, event_id, created_at) VALUES (?, ?, ?)'),
    keyLookup: db.prepare('SELECT e.slug FROM idempotency_keys k JOIN events e ON e.id = k.event_id WHERE k.key = ?'),
    getEvent: db.prepare('SELECT * FROM events WHERE slug = ?'),
    getOpts: db.prepare('SELECT id, start_at, end_at, position FROM time_options WHERE event_id = ? ORDER BY start_at, end_at IS NOT NULL, end_at, position'),
  };

  const create = db.transaction((v, idemKey) => {
    if (idemKey) { const hit = q.keyLookup.get(idemKey); if (hit) return { slug: hit.slug, replayed: true }; }
    const slug = crypto.randomBytes(16).toString('base64url'); // 128 bits
    const ts = now().toISOString();
    const { lastInsertRowid: id } = q.insertEvent.run(slug, v.title, v.description, ts);
    v.time_options.forEach((o, i) => q.insertOpt.run(id, o.start_at, o.end_at, i));
    if (idemKey) q.insertKey.run(idemKey, id, ts);
    return { slug, replayed: false };
  });

  function load(slug) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
    const ev = q.getEvent.get(slug);
    if (!ev) return null;
    return { id: ev.slug, slug: ev.slug, title: ev.title, description: ev.description, created_at: ev.created_at,
      time_options: q.getOpts.all(ev.id) };
  }

  // Design data shape: options[{date,start,end}] as wall-clock in a given IANA zone (default UTC).
  function withDesignShape(ev, tz) {
    let zone = 'UTC';
    if (typeof tz === 'string' && tz.length <= 64) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } catch { /* invalid → UTC */ }
    }
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = (iso) => Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    const options = ev.time_options.map((o) => {
      const s = parts(o.start_at), e = o.end_at ? parts(o.end_at) : null;
      return { date: `${s.year}-${s.month}-${s.day}`, start: `${s.hour}:${s.minute}`, end: e ? `${e.hour}:${e.minute}` : null,
        ...(e && `${e.year}-${e.month}-${e.day}` !== `${s.year}-${s.month}-${s.day}` ? { end_date: `${e.year}-${e.month}-${e.day}` } : {}) };
    });
    return { ...ev, timezone: zone, options, url: `/p/${ev.slug}` };
  }

  app.post('/api/events', express.json({ limit: '32kb', strict: false, type: () => true }), (req, res) => {
    const idemKey = req.get('Idempotency-Key');
    if (idemKey !== undefined && !IDEMPOTENCY_RE.test(idemKey)) {
      return res.status(400).json({ errors: ['Ugyldig Idempotency-Key (8-100 tegn: A-Z, a-z, 0-9, _ eller -).'] });
    }
    if (idemKey) { // replay before validation, so a retry after the time passed still returns the poll
      const hit = q.keyLookup.get(idemKey);
      if (hit) return res.status(200).set('Idempotent-Replayed', 'true').json(withDesignShape(load(hit.slug), req.query.tz));
    }
    const { errors, value } = validateEvent(req.body, now());
    if (errors.length) return res.status(400).json({ errors });
    const { slug, replayed } = create(value, idemKey);
    if (replayed) res.status(200).set('Idempotent-Replayed', 'true'); else res.status(201);
    res.location(`/p/${slug}`).json(withDesignShape(load(slug), req.query.tz));
  });

  app.get('/api/events/:slug', (req, res) => {
    const ev = load(req.params.slug);
    if (!ev) return res.status(404).json({ errors: ['Afstemningen findes ikke.'] });
    res.json(withDesignShape(ev, req.query.tz));
  });
  app.use('/api', (req, res) => res.status(404).json({ errors: ['Ikke fundet.'] }));

  // Server-rendered view page: only <title>/meta are injected (escaped); body is filled by poll.js.
  const pollTpl = fs.readFileSync(path.join(PUB, 'poll.html'), 'utf8');
  app.get('/e/:slug', (req, res) => {
    if (!SLUG_RE.test(req.params.slug)) return res.status(404).type('text').send('Ikke fundet');
    res.redirect(301, `/p/${req.params.slug}`);
  });
  app.get('/p/:slug', (req, res) => {
    const ev = load(req.params.slug);
    const title = ev ? ev.title : 'Afstemningen findes ikke';
    const desc = ev ? (ev.description || 'Vælg de tidspunkter, der passer dig.') : '';
    const html = pollTpl
      .replaceAll('{{TITLE}}', escapeHtml(title))
      .replaceAll('{{DESCRIPTION}}', escapeHtml(desc.slice(0, 300)))
      .replaceAll('{{URL}}', escapeHtml(`${req.protocol}://${req.get('host')}/p/${ev ? ev.slug : ''}`));
    res.status(ev ? 200 : 404).type('html').set('Cache-Control', 'no-store').send(html);
  });
  app.get('/poll.html', (req, res) => res.status(404).end());
  app.use(express.static(PUB));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ errors: ['Forespørgslen er for stor (maks. 32 kB).'] });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['Ugyldig JSON.'] });
    const status = err.status || err.statusCode;
    if (status >= 400 && status < 500) return res.status(status).json({ errors: ['Ugyldig forespørgsel.'] });
    console.error(err);
    res.status(500).json({ errors: ['Serverfejl.'] });
  });
  return app;
}
module.exports = { createApp, escapeHtml };
