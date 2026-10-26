// VANT Tracker – lokálny server
// - servíruje vant_tracker.html na http://localhost:8787
// - /api/fetch : proxy na turnajové API (obchádza CORS, ktoré prehliadač blokuje)
// - /api/page  : stiahne verejnú stránku a vytiahne z nej čitateľný text
// - /api/claude: AI extrakcia turnajov zo screenshotu / stránky cez Claude API
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const VERSION = '2.0.0';
const UA = 'VANT-Tracker/2.0 (personal CS2 tournament tracker; non-commercial)';
// Bežné weby často blokujú ne-prehliadačové požiadavky; Liquipedia API naopak vyžaduje popisný User-Agent.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_PAGE_CHARS = 150000;

// ---------- helpers ----------
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function readJson(req, limit = 25 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Požiadavka je príliš veľká'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Blokuje lokálne/privátne adresy, aby proxy nešla do tvojej siete.
function checkPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('Neplatná URL'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Povolené sú len http/https URL'), { status: 400 });
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0' || h === '[::1]' ||
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) {
    throw Object.assign(new Error('Lokálne adresy nie sú povolené'), { status: 400 });
  }
  return u;
}

// Rozostupy medzi požiadavkami na rovnaký host (Liquipedia: action=parse max 1 za 30 s).
const hostQueues = new Map();
function spacingFor(u) {
  if (u.hostname.endsWith('liquipedia.net') && u.searchParams.get('action') === 'parse') return 30000;
  if (u.hostname.endsWith('liquipedia.net')) return 2000;
  if (u.hostname.endsWith('faceit.com')) return 300;
  return 250;
}
function scheduled(u, fn) {
  const key = u.hostname;
  const prev = hostQueues.get(key) || { tail: Promise.resolve(), last: 0 };
  const gap = spacingFor(u);
  const run = prev.tail.then(async () => {
    const wait = prev.last + gap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try { return await fn(); } finally { prev.last = Date.now(); }
  });
  prev.tail = run.catch(() => {});
  hostQueues.set(key, prev);
  return run;
}

const cache = new Map(); // key -> {until, value}
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (hit) cache.delete(key);
  return null;
}

const FORWARD_HEADERS = ['authorization', 'x-api-key', 'range', 'accept'];

async function proxyFetch({ url, headers = {}, ttl = 0 }) {
  const u = checkPublicUrl(url);
  const h = { 'User-Agent': u.hostname.endsWith('liquipedia.net') ? UA : BROWSER_UA, 'Accept': 'application/json, text/html;q=0.9, */*;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' };
  for (const [k, v] of Object.entries(headers || {})) {
    if (FORWARD_HEADERS.includes(k.toLowerCase()) && v) h[k] = String(v);
  }
  const cacheKey = u.href + '|' + (h.Authorization || h.authorization || h['X-Api-Key'] || h['x-api-key'] || '').slice(-12) + '|' + (h.Range || h.range || '');
  const cached = ttl > 0 && cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };
  const value = await scheduled(u, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(u.href, { headers: h, signal: ctrl.signal, redirect: 'follow' });
      const body = await r.text();
      return { ok: r.ok, status: r.status, contentRange: r.headers.get('content-range') || '', contentType: r.headers.get('content-type') || '', body };
    } finally { clearTimeout(timer); }
  });
  if (ttl > 0 && value.ok) cache.set(cacheKey, { until: Date.now() + ttl * 1000, value });
  return value;
}

// Z HTML vytiahne titulok, meta popis, JSON dáta (ld+json, __NEXT_DATA__) a viditeľný text.
function htmlToText(html) {
  const pick = re => (html.match(re) || [])[1] || '';
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i).trim();
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const jsonBlocks = [...html.matchAll(/<script[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1].trim()).filter(Boolean);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  let out = `TITLE: ${title}\nDESCRIPTION: ${desc}\n\nVISIBLE TEXT:\n${text}`;
  if (jsonBlocks.length) out += `\n\nEMBEDDED JSON DATA:\n${jsonBlocks.join('\n')}`;
  return out;
}

// ---------- Claude ----------
const TOURNAMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tournaments'],
  properties: {
    tournaments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'platform', 'date', 'time', 'mode', 'region', 'buyin', 'prize', 'p1', 'p2', 'p3', 'currentPlayers', 'maxPlayers', 'url', 'note'],
        properties: {
          name: { type: 'string', description: 'Názov turnaja' },
          platform: { type: 'string', description: 'Stránka/platforma, napr. FACEIT, FastCup, Challengermode, Esportal, Vieforit, Toornament, Discord / Community' },
          date: { type: 'string', description: 'Dátum začiatku YYYY-MM-DD, alebo prázdny reťazec ak nie je známy' },
          time: { type: 'string', description: 'Čas začiatku HH:MM v miestnom čase Európa/Bratislava, alebo prázdny reťazec' },
          mode: { type: 'string', description: 'Jeden z: 5v5, 3v3, 2v2, 1v1, Wingman, Scrim, Team vs Team' },
          region: { type: 'string', description: 'Jeden z: Europe, Russia, CZ/SK, Germany, Poland, International, Vlastný región' },
          buyin: { type: 'number', description: 'Vstupný poplatok v EUR (0 ak free)' },
          prize: { type: 'number', description: 'Celkový prize pool v EUR (0 ak nie je peňažný)' },
          p1: { type: 'number', description: 'Výhra za 1. miesto pre celý tím v EUR' },
          p2: { type: 'number', description: 'Výhra za 2. miesto pre celý tím v EUR' },
          p3: { type: 'number', description: 'Výhra za 3. miesto pre celý tím v EUR' },
          currentPlayers: { type: 'string', description: 'Počet prihlásených hráčov/tímov, alebo prázdny reťazec' },
          maxPlayers: { type: 'string', description: 'Maximálny počet slotov, alebo prázdny reťazec' },
          url: { type: 'string', description: 'Odkaz na turnaj, alebo prázdny reťazec' },
          note: { type: 'string', description: 'Krátka poznámka po slovensky: nevpeňažné ceny (body, skiny), podmienky, check-in' }
        }
      }
    }
  }
};

function systemPrompt(today) {
  return `Si extraktor dát o Counter-Strike 2 turnajoch pre súkromný tracker. Dnes je ${today} (časové pásmo Europe/Bratislava).
Vráť iba turnaje, ktoré sú v podkladoch skutočne uvedené – nič nevymýšľaj. Chýbajúce textové údaje nechaj prázdne, chýbajúce čísla daj 0.
Peniaze prepočítaj na EUR (USD×0.92, RUB×0.0105, PLN×0.23, CZK×0.04); ak cena nie je peňažná (FACEIT body, skiny), daj 0 a popíš ju do note.
Relatívne dátumy (dnes, zajtra, "in 2 days") prepočítaj podľa dnešného dátumu. Ak je to zoznam, vráť všetky CS2 turnaje (max 60), ktoré ešte nezačali alebo práve bežia.`;
}

async function claudeExtract(body) {
  const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Chýba Claude API kľúč (zadaj ho v Nastaveniach).'), { status: 400 });
  const client = new Anthropic({ apiKey, timeout: 180000, maxRetries: 2 });
  const today = body.today || new Date().toISOString().slice(0, 10);

  const content = [];
  if (body.task === 'image') {
    const m = String(body.image || '').match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
    if (!m) throw Object.assign(new Error('Obrázok musí byť PNG, JPEG, GIF alebo WEBP.'), { status: 400 });
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    content.push({ type: 'text', text: 'Toto je screenshot CS2 turnaja (alebo zoznamu turnajov). Vytiahni z neho údaje o turnaji/turnajoch.' });
  } else {
    let pageText = String(body.text || '');
    let truncated = false;
    if (!pageText && body.url) {
      const r = await proxyFetch({ url: body.url, ttl: 600 });
      if (!r.ok) throw Object.assign(new Error(`Stránka vrátila HTTP ${r.status}`), { status: 502 });
      pageText = htmlToText(r.body);
    }
    if (pageText.length > MAX_PAGE_CHARS) { pageText = pageText.slice(0, MAX_PAGE_CHARS); truncated = true; }
    content.push({ type: 'text', text: `Zdroj: ${body.url || 'vložený text'}${truncated ? ' (text bol skrátený na prvých ' + MAX_PAGE_CHARS + ' znakov)' : ''}\n\n<page>\n${pageText}\n</page>\n\nVytiahni z tejto stránky CS2 turnaje.` });
  }

  const model = body.model || DEFAULT_MODEL;
  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: TOURNAMENT_SCHEMA } },
    system: systemPrompt(today),
    messages: [{ role: 'user', content }]
  };
  // Server-side fallback pri odmietnutí (Haiku ho nepodporuje).
  if (!/haiku/.test(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  const response = await client.beta.messages.create(params);

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('Claude požiadavku odmietol' + (response.stop_details?.explanation ? ': ' + response.stop_details.explanation : '.')), { status: 422 });
  }
  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(new Error('Odpoveď bola príliš dlhá (max_tokens). Skús menšiu stránku.'), { status: 422 });
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error('Claude nevrátil platný JSON.'), { status: 502 }); }
  return { tournaments: Array.isArray(parsed.tournaments) ? parsed.tournaments : [], model: response.model, usage: response.usage };
}

function claudeErrorMessage(e) {
  if (e instanceof Anthropic.AuthenticationError) return { status: 401, error: 'Neplatný Claude API kľúč.' };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 403, error: 'Kľúč nemá prístup k tomuto modelu.' };
  if (e instanceof Anthropic.NotFoundError) return { status: 404, error: 'Model neexistuje – skontroluj výber modelu v Nastaveniach.' };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, error: 'Claude API: prekročený limit, skús o chvíľu.' };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, error: 'Claude API odmietlo požiadavku: ' + e.message };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, error: 'Nepodarilo sa spojiť s Claude API.' };
  if (e instanceof Anthropic.APIError) return { status: e.status || 502, error: `Claude API chyba ${e.status}: ${e.message}` };
  return { status: e.status || 500, error: e.message || String(e) };
}

// ---------- FastCup ----------
// FastCup (Hasura) prijíma len dotazy, ktoré používa ich vlastná stránka – toto je ich presný dotaz
// "GetTournaments" (cs2.fastcup.net/tournaments). Vracia max. 100 turnajov naraz, preto stránkujeme podľa času.
const FASTCUP_QUERY = `query GetTournaments($name: String, $state: [tournament_state!]!, $gameId: smallint, $gameModeIds: [Int!], $serverRegionIds: [Int!], $firstStageScheduledAtOrderBy: order_by, $finishedAtOrderBy: order_by, $firstStageScheduledAtGt: timestamptz, $finishedAtLt: timestamptz, $limit: Int!, $currentUserId: Int, $premiumRequired: Boolean) {
  tournaments(
    where: {name: {_ilike: $name}, state: {_in: $state}, game_id: {_eq: $gameId}, game_mode_id: {_in: $gameModeIds}, _or: [{visible: {_eq: true}}, {organizer: {members: {user_id: {_eq: $currentUserId}}}}], serverRegions: {server_region_id: {_in: $serverRegionIds}}, first_stage_scheduled_at: {_gt: $firstStageScheduledAtGt}, finished_at: {_lt: $finishedAtLt}, premium_required: {_eq: $premiumRequired}}
    order_by: [{pinned: desc}, {first_stage_scheduled_at: $firstStageScheduledAtOrderBy}, {finished_at: $finishedAtOrderBy}]
    limit: $limit
  ) {
    id
    name
    description
    state
    slots
    logo
    pinned
    banner
    visible
    gameModeId: game_mode_id
    matchConfigId: match_config_id
    benchSize: bench_size
    premiumRequired: premium_required
    anticheatEnabled: anticheat_enabled
    automaticPaymentsEnabled: automatic_payments_enabled
    prizeFund: prize_fund
    finishedAt: finished_at
    activeRosters: active_rosters
    firstStageScheduledAt: first_stage_scheduled_at
    serverRegions {
      serverRegionId: server_region_id
      __typename
    }
    isVisibilityRegional: is_visibility_regional
    allowedRegions {
      countryId: country_id
      __typename
    }
    gameMode {
      name: name_en
      teamSize: team_size
      __typename
    }
    organizer {
      name
      __typename
    }
    standings {
      number
      winlineFreebet: winline_freebet {
        amount
        __typename
      }
      __typename
    }
    __typename
  }
}`;
async function fastcupTournaments(days = 14) {
  const cached = cacheGet('fastcup');
  if (cached) return cached;
  const horizon = Date.now() + days * 864e5;
  const seen = new Map();
  let after = null;
  for (let page = 0; page < 10; page++) {
    const r = await fetch('https://hasura.fastcup.net/v1/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA, Origin: 'https://cs2.fastcup.net', Referer: 'https://cs2.fastcup.net/' },
      body: JSON.stringify({
        operationName: 'GetTournaments',
        variables: { state: ['SCHEDULED', 'REGISTRATION', 'ACTIVE'], gameId: 3, firstStageScheduledAtOrderBy: 'asc', currentUserId: null, limit: 100, ...(after ? { firstStageScheduledAtGt: after } : {}) },
        query: FASTCUP_QUERY
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.errors) throw Object.assign(new Error('FastCup: ' + (j.errors?.[0]?.message || 'HTTP ' + r.status)), { status: 502 });
    const list = j.data?.tournaments || [];
    let last = after;
    for (const t of list) {
      const { standings, ...rest } = t; // standings sú obrovské, stačí počet miest s výhrou
      const st = Array.isArray(standings) ? standings : [];
      const freebetRub = st.reduce((s, x) => s + (Number(x.winlineFreebet?.amount) || 0), 0); // Winline platí freebetmi v rubľoch
      seen.set(t.id, { ...rest, paidPlaces: st.length, freebetRub });
      if (!t.pinned && t.firstStageScheduledAt && (!last || t.firstStageScheduledAt > last)) last = t.firstStageScheduledAt;
    }
    if (list.length < 100 || !last || last === after || Date.parse(last) > horizon) break;
    after = last;
  }
  const out = [...seen.values()].filter(t => !t.firstStageScheduledAt || Date.parse(t.firstStageScheduledAt) <= horizon);
  cache.set('fastcup', { until: Date.now() + 5 * 60e3, value: out });
  return out;
}

// ---------- trvalé úložisko: data/vant-data.json + denné zálohy ----------
const DATA_DIR = path.join(here, 'data');
const STORE_FILE = path.join(DATA_DIR, 'vant-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'zalohy');
function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return {}; }
}
function writeStore(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Object.assign(new Error('Neplatné dáta'), { status: 400 });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const json = JSON.stringify({ ...obj, savedAt: new Date().toISOString() }, null, 1);
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, STORE_FILE); // atomický zápis – pri páde sa súbor nepoškodí
  // jedna záloha na deň, uchovávame posledných 30
  const day = new Date().toISOString().slice(0, 10);
  const backup = path.join(BACKUP_DIR, `vant-${day}.json`);
  fs.copyFileSync(STORE_FILE, backup);
  const old = fs.readdirSync(BACKUP_DIR).filter(f => /^vant-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -30);
  for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // Tracker otvorený priamo zo súboru (file://) posiela Origin "null" – povolíme len ten.
  if (req.headers.origin === 'null') {
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/vant_tracker.html')) {
      return send(res, 200, fs.readFileSync(path.join(here, 'vant_tracker.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, version: VERSION, claudeEnvKey: !!process.env.ANTHROPIC_API_KEY });
    }
    if (req.method === 'POST' && url.pathname === '/api/fetch') {
      const body = await readJson(req);
      return send(res, 200, await proxyFetch(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/page') {
      const body = await readJson(req);
      const r = await proxyFetch({ url: body.url, ttl: 600 });
      return send(res, 200, { ok: r.ok, status: r.status, text: r.ok ? htmlToText(r.body) : '' });
    }
    if (req.method === 'POST' && url.pathname === '/api/claude') {
      const body = await readJson(req);
      try {
        return send(res, 200, await claudeExtract(body));
      } catch (e) {
        const m = claudeErrorMessage(e);
        return send(res, m.status, { error: m.error });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/fastcup') {
      return send(res, 200, { tournaments: await fastcupTournaments(Number(url.searchParams.get('days')) || 14) });
    }
    if (req.method === 'GET' && url.pathname === '/api/store') {
      return send(res, 200, readStore());
    }
    if (req.method === 'PUT' && url.pathname === '/api/store') {
      // zápis povolíme len zo stránky na tomto serveri (nie z cudzích webov)
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return send(res, 403, { error: 'Zakázané' });
      const body = await readJson(req, 50 * 1024 * 1024);
      writeStore(body);
      return send(res, 200, { ok: true, savedAt: Date.now(), file: STORE_FILE });
    }
    send(res, 404, { error: 'Nenájdené' });
  } catch (e) {
    console.error(e);
    send(res, e.status || 500, { error: e.name === 'AbortError' ? 'Vypršal čas požiadavky' : (e.message || 'Chyba servera') });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  VANT Tracker ${VERSION} beží na  http://localhost:${PORT}\n  (okno nechaj otvorené, zatvorením sa server vypne)\n`);
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log(`Port ${PORT} je obsadený – tracker už pravdepodobne beží: http://localhost:${PORT}`);
  else console.error(e);
});
