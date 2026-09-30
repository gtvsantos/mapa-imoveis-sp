/* ════════ Radar ITBI · lógica das abas (Cidade · Quadrante · Distrito · Prédio) ════════ */
/* erros de execução ficam também em <html data-err> (visível a ferramentas de teste) */
const logErr = m => { const r = document.documentElement; r.dataset.err = ((r.dataset.err || '') + ' || ' + m).slice(-4000); };
window.addEventListener('error', e => logErr(e.message + ' @' + e.lineno + ':' + e.colno));
window.addEventListener('unhandledrejection', e => logErr('promise: ' + (e.reason && e.reason.stack || e.reason)));
const M = D.meta, Q = M.q, NQ = Q.length, LQ = NQ - 1, QF = M.q_from_full, QR = M.q_from_recent, MIN = M.min_n;
const FX = M.faixas, ANOS = M.anos, TC = M.tipo_code, MOT = M.motivos;
const TIPO_OF = Object.fromEntries(Object.entries(TC).map(([k, v]) => [v, k]));
/* tipos (I-036, 30/09): seis GRUPOS no seletor (apto · casa · terreno · sala = lojas, escritórios e comerciais · vaga · galpao);
   o tipo bruto de cada negócio/lote (apto, casa, sala, loja, escr, vaga, terreno, galpao, outros, planta) mapeia para um grupo.
   Base do preço por grupo: m2c = R$/m² de área construída · m2t = R$/m² de área do terreno · unid = R$ por vaga. */
const TIPOS = M.tipos || ['apto', 'casa', 'sala'];
const GRP = M.grupo || {apto: 'apto', casa: 'casa', sala: 'sala', loja: 'sala'};
const TIPO_LB = Object.assign({apto: 'Apartamento', casa: 'Casa', sala: 'Sala/flat comercial', loja: 'Loja', vaga: 'Vaga', terreno: 'Terreno', outros: 'Outros', planta: 'Planta'}, M.tipo_lb || {});
const GRP_LB = M.grupo_lb || {apto: 'Apartamentos', casa: 'Casas', sala: 'Salas/flats comerciais'};
const GRP_LB1 = M.grupo_lb1 || {apto: 'Apartamento', casa: 'Casa', sala: 'Sala/flat comercial'};
const BASE = M.base || {}, BASE_LB = M.base_lb || {m2c: 'R$/m² de área construída (IPTU)'};
const DIMS_T = M.dims_tipo || {};
const TIPO_TT = {apto: 'Apartamentos e flats residenciais em condomínio (usos IPTU 20 e 25) · R$/m² de área construída',
  casa: 'Residências, residências coletivas e uso misto predominantemente residencial (usos 10, 12, 13, 14) · R$/m² construído',
  terreno: 'Terrenos sem construção (uso 0) · preço em R$/m² de área do terreno',
  sala: 'Salas e consultórios em condomínio, flats comerciais, lojas e prédios de escritório (usos 30, 85, 40, 41, 42, 31) · R$/m² construído',
  vaga: 'Vagas de garagem como unidade autônoma (usos 23, 24, 62, 63) · preço em R$ por vaga',
  galpao: 'Armazéns, depósitos e indústrias (usos IPTU 50 e 51) · R$/m² de área construída'};
const grpOf = t => (t && GRP[t]) || null;
const baseOf = (tipo = S.tipo) => BASE[tipo] || 'm2c';
const FXD = (dim, tipo = S.tipo) => (M.faixas_tipo && M.faixas_tipo[tipo] && M.faixas_tipo[tipo][dim]) || FX[dim] || [];
const PU_LB = {m2c: 'R$/m²', m2t: 'R$/m² de terreno', unid: 'R$/vaga'};
const PU = (tipo = S.tipo) => PU_LB[baseOf(tipo)] || 'R$/m²';
const fPrice = (v, tipo = S.tipo) => v == null ? '—' : baseOf(tipo) === 'unid' ? 'R$ ' + nf0.format(v) : 'R$ ' + nf0.format(v) + '/m²';
const LOT_SCALE = {m2c: [1500, 16000], m2t: [150, 12000], unid: [8000, 150000]};   // escala de cor dos lotes por base
const DF = D.geo.distritos.features, DIST = {};
DF.forEach(f => { DIST[f.properties.cd] = f.properties; });
const DCODES = DF.map(f => f.properties.cd).filter(cd => D.vol[cd]);
const dname = cd => cd === 'SP' ? 'Cidade de São Paulo' : DIST[cd] ? DIST[cd].nome : cd;
const LAST_FULL_Y = +M.last_q.slice(-4) - (M.last_q.startsWith('4T') ? 0 : 1);   // último ano fechado
const YI = y => ANOS.indexOf(y);
const FXLB = {
  area: {'≤45': '≤45 m² · studio/compacto', '45–70': '45–70 m²', '70–100': '70–100 m²', '100–150': '100–150 m²', '150–250': '150–250 m²', '>250': '>250 m² · grande'},
  padrao: {A: 'Padrão A (simples)', B: 'Padrão B', C: 'Padrão C', D: 'Padrão D', E: 'Padrão E', F: 'Padrão F (alto)'},
  idade: {'≤3': 'Novo (≤3 anos)', '4–10': '4–10 anos', '11–20': '11–20 anos', '21–35': '21–35 anos', '>35': '>35 anos'},
  quartos: {'1': '1 dorm.', '2': '2 dorms.', '3': '3 dorms.', '4+': '4+ dorms.'},
};
const DIMLB = {area: 'tamanho', padrao: 'padrão', idade: 'idade', quartos: 'quartos'};
const fxLab = (dim, f, tipo = S.tipo) => (FXLB[dim] && FXLB[dim][f]) || (dim === 'area' ? f + ' m²' + (baseOf(tipo) === 'm2t' ? ' de terreno' : '') : f);
const fR = v => v == null ? '—' : 'R$ ' + nf0.format(v);
const fRm2 = v => v == null ? '—' : 'R$ ' + nf0.format(v) + '/m²';
const fMi = v => v == null ? '—' : v >= 1000 ? 'R$ ' + nf1.format(v / 1000) + ' bi' : 'R$ ' + nf0.format(v) + ' mi';
const fDate = d => { if (d == null) return '—'; const t = new Date(Date.UTC(2006, 0, 1) + d * 864e5); return t.toISOString().slice(0, 10).split('-').reverse().join('/'); };
const fSig = (v, d = 1) => v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '±') + (d ? nf1 : nf0).format(Math.abs(v)) + '%';

/* ── estratos: paleta azul → amarelo → laranja (longe do verde/vermelho de bom/ruim) ── */
const PAL = {light: ['#1b4f96', '#3f80d2', '#90bcef', '#f0bf3f', '#eb8a34', '#b3531a'], dark: ['#4a8ee0', '#7fb0ee', '#b6d3f5', '#f4cd6a', '#f09a4f', '#dd7a40']};
function fxColors(dim, tipo = S.tipo) {
  const p = PAL[mode()], n = FXD(dim, tipo).length;
  return n === 6 ? p : n === 5 ? [p[0], p[1], p[3], p[4], p[5]] : n === 4 ? [p[0], p[2], p[3], p[5]] : [css('--ink')];
}
const fxColor = (dim, f) => f === '*' || f === 'todos' ? css('--ink') : fxColors(dim)[FXD(dim).indexOf(f)];
/* intensidade (verde → amarelo → vermelho) só onde "menos é melhor/pior" por período (exclusão) */
const HEAT = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];
/* preço: sequencial azul; variação: divergente azul (queda) ↔ laranja (alta) */
const DIVL = {light: ['#1c5cab', '#86b6ef', '#efeee9', '#f3b27a', '#c85f16'], dark: ['#3987e5', '#1d3a5e', '#383835', '#6b3a1a', '#f0934a']};
const priceColor = (v, lo, hi) => v == null ? css('--gray-cell') : ramp(RAMP[mode()].seq, (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
const varColor = (v, lim) => v == null ? css('--gray-cell') : ramp(DIVL[mode()], 0.5 + clamp(v / lim, -1, 1) / 2);
const heatColor = (v, lo, hi) => v == null ? css('--gray-cell') : ramp(HEAT, (v - lo) / (hi - lo));

/* aluguel e yield: violeta de um só matiz (OKLCH h≈284, L monótona; validado: dataviz --ordinal, luz e escuro);
   mercado primário: laranja (--pl). Uma escala contínua por mapa (A6 · H17). */
const VIOLET = {light: ['#9895f0', '#7f79e2', '#685dcf', '#5343b7', '#3f2e95', '#2c1f6e'], dark: ['#564cae', '#6b63ce', '#827ce6', '#9b99f3', '#b5b5fc', '#d2d3ff']};
const ORANGE = {light: ['#f7d3b3', '#f0b079', '#e8914a', '#e07b1f', '#b8621a', '#8a4914'], dark: ['#5a3418', '#7d4720', '#a55d28', '#d27732', '#f0934a', '#f7b98a']};

/* ── estado ───────────────────────────────────────────── */
/* o que muda a resposta vai na URL (#/vista/id?parâmetros); o localStorage guarda só a última sessão */
const S = {view: 'cidade', tipo: 'apto', dim: 'area', fx: '*', met: 'preco', cd: '62', lot: null, lotCd: null, years: 10,
  cityRef: true, radius: 1, compYears: 2, qmin: 30, qCI: true, qLab: true, qSel: null, bldOnlyStr: true, sorts: {}, pages: {}, dtMet: 'm',
  cam: null, soloPrev: null, p: {}};
const PREF = ['tipo', 'dim', 'fx', 'met', 'cd', 'lot', 'lotCd', 'years', 'radius', 'compYears', 'qmin'];
function loadPrefs() { try { const s = JSON.parse(localStorage.getItem('radarITBI') || '{}'); PREF.forEach(k => { if (s[k] != null) S[k] = s[k]; }); if (Array.isArray(s.cam)) S.cam = new Set(s.cam); } catch (e) {} }
function save() { try { const o = {}; PREF.forEach(k => { o[k] = S[k]; }); o.cam = S.cam ? [...S.cam] : null; localStorage.setItem('radarITBI', JSON.stringify(o)); } catch (e) {} }
const skey = (tipo = S.tipo, dim = S.dim, fx = S.fx) => fx === '*' ? `${tipo}|todos|todos` : `${tipo}|${dim}|${fx}`;
const sLabel = () => `${GRP_LB[S.tipo] || TIPO_LB[S.tipo]} · ${S.fx === '*' ? 'todas as faixas' : fxLab(S.dim, S.fx)}`;

/* ── séries (mediana móvel 12 m com IQR e n) ─────────────── */
const DFILE = {}, DPEND = {};
function ser(cd, key, full) {
  let s, q0;
  if (cd === 'SP') { s = D.city.series[key]; q0 = QF; }
  else if (full) { if (!DFILE[cd]) return undefined; s = DFILE[cd].series[key]; q0 = QF; }
  else { s = (D.recent[cd] || {})[key]; q0 = QR; }
  return s ? {n: s[0], a: s[1], m: s[2], b: s[3], q0} : null;
}
/* intervalo de 95% da mediana ≈ med ± 1,58·IQR/√n (entalhe de McGill et al., 1978) */
function st(s, qi) {
  if (!s) return null; const j = qi - s.q0; if (j < 0 || j >= s.n.length) return null;
  const n = s.n[j]; if (!n) return {n: 0, ok: false};
  const m = s.m[j], a = s.a[j], b = s.b[j], h = 1.58 * (b - a) / Math.sqrt(n);
  return {n, m, a, b, lo: m - h, hi: m + h, ok: n >= MIN};
}
function delta(s, qi) {
  const x = st(s, qi), y = st(s, qi - 4);
  if (!x || !y || !x.ok || !y.ok) return null;
  return {v: (x.m / y.m - 1) * 100, lo: (x.lo / y.hi - 1) * 100, hi: (x.hi / y.lo - 1) * 100, n1: x.n, n0: y.n, sig: x.lo > y.hi || x.hi < y.lo};
}
const sum = (a, i0, i1) => { let s = 0; for (let i = Math.max(0, i0); i <= i1; i++) s += a[i] || 0; return s; };
function geoStats(cd) {
  const v = D.vol[cd], e = D.exc[cd]; if (!v) return null;
  const s = ser(cd, skey(), false), x = st(s, LQ), dv = delta(s, LQ);
  const yi = YI(LAST_FULL_Y), g = e && e.giro ? e.giro[yi] : null;
  const fin = (() => { let n = 0, k = 0; for (let i = LQ - 3; i <= LQ; i++) { if (v.fin[i] != null) { n += v.nres[i]; k += v.fin[i] / 100 * v.nres[i]; } } return n >= MIN ? k / n * 100 : null; })();
  return {cd, name: dname(cd), x, dv, own: sum(v.own, LQ - 3, LQ), pl: sum(v.pl, LQ - 3, LQ), rv: sum(v.rv, LQ - 3, LQ), rvp: sum(v.rvp, LQ - 3, LQ),
    giro: g && g[1] ? g[0] / g[1] * 100 : null, giroN: g, fin,
    excl: e && e.uni[yi] >= 20 ? (e.pl[yi] + e.fl[yi]) / e.uni[yi] * 100 : null, exclPl: e && e.uni[yi] ? e.pl[yi] / e.uni[yi] * 100 : null, uni: e ? e.uni[yi] : 0};
}
function fetchDist(cd) {
  if (DFILE[cd]) return Promise.resolve(DFILE[cd]);
  if (DPEND[cd]) return DPEND[cd];
  const base = /^https?:$/.test(location.protocol) ? '' : 'http://127.0.0.1:8766/';
  return DPEND[cd] = fetch(base + 'dist/' + cd + '.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(j => {
    j.lots.forEach((l, i) => { l.i = i; l.cd = cd; });
    DFILE[cd] = j; delete DPEND[cd]; return j;
  }).catch(err => { delete DPEND[cd]; console.warn('dist', cd, err); throw err; });
}
function decodeRings(g) {
  return g.map(r => { const ring = []; let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; ring.push([x / 1e6, y / 1e6]); } if (ring.length) ring.push(ring[0]); return ring; });
}
function lotFeature(l) {
  if (!l._geom) { const rs = decodeRings(l.g); l._geom = rs.length === 1 ? {type: 'Polygon', coordinates: [rs[0]]} : {type: 'MultiPolygon', coordinates: rs.map(r => [r])}; }
  return l._geom;
}
const haversine = (a, b) => { const R = 6371, t = Math.PI / 180, dl = (b[1] - a[1]) * t, dg = (b[0] - a[0]) * t; const s = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

/* ── registro: o núcleo é estendido por módulos (src/m_*.js, cada um no seu <script>) ── */
const $ = id => document.getElementById(id);
const REG = {views: [], sections: {}, badges: {}, metrics: [], layers: [], presets: [], params: [], decor: []};
/* vistas desligadas por enquanto (pedido de 28/09/2026): seguem registradas, com HTML e código intactos, mas saem do menu
   e a URL delas cai na Cidade. Para religar, basta tirar o id daqui. */
const DISABLED = new Set(['quadrante', 'primario', 'flips', 'terrenos', 'aluguel']);
const byOrder = (a, b) => (a.order || 100) - (b.order || 100);
/* vista: {id, label, sub, group: 'geo'|'radar', order, ids: ['cd'…] (partes do caminho → S), html (seção nova),
   render(), estrato: {tipos, dims} (o que o tema aceita; o resto fica desabilitado com a dica)} */
function registerView(v) {
  const d = Object.assign({group: 'radar', order: 100, ids: []}, v);
  REG.views = REG.views.filter(x => x.id !== d.id).concat(d);
  if (d.html != null && !document.getElementById('v-' + d.id)) {
    const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'v-' + d.id; sec.hidden = true; sec.innerHTML = d.html;
    $('main').appendChild(sec);
  }
  if (STARTED) buildRail();
  return d;
}
const viewDef = id => REG.views.find(v => v.id === id);
const viewOn = id => !!viewDef(id) && !DISABLED.has(id);
/* seção extra numa página existente: {id, title, sub, order, render(el, ctx)} — ctx de Distrito {cd, F?}, de Prédio {cd, lot, F, ks} */
function registerSection(view, sec) { (REG.sections[view] = REG.sections[view] || []).push(Object.assign({order: 100}, sec)); REG.sections[view].sort(byOrder); }
/* selo no cabeçalho de uma página (ex.: "é o lançamento X →"): fn(ctx) → html */
function registerBadge(view, fn) { (REG.badges[view] = REG.badges[view] || []).push(fn); }
/* cor dos distritos: {id, label, group, order, title, palette: 'seq'|'div'|'heat'|'alug'|'pl', log,
   value(cd) → número|null, ok(cd) → n suficiente?, fmt(v), domain(valores) → [lo, hi], legendLabel(), tip(cd) → html} */
function registerMetric(m) { REG.metrics = REG.metrics.filter(x => x.id !== m.id).concat(Object.assign({group: 'Outros', order: 100}, m)); }
/* camada do mapa da Cidade: {id, group, order, label, title, minzoom, def, fill (escala contínua própria), subs: [{id, label, def}],
   add(H, below), update(H), setVisible(H, on), onMove(H), hitLayers() → ids, tip(f), click(f), legend() → html, note() → html} */
function registerLayer(l) { REG.layers = REG.layers.filter(x => x.id !== l.id).concat(Object.assign({group: 'Outros', order: 100, def: false, subs: []}, l)); }
/* vista pronta: {id, label, order, met, cam: [...]} */
function registerPreset(p) { REG.presets = REG.presets.filter(x => x.id !== p.id).concat(Object.assign({order: 100}, p)); }
/* parâmetro de URL de um módulo: {k, get() → string, set(string), def, views: [...]} */
function registerParam(p) { REG.params = REG.params.filter(x => x.k !== p.k).concat(p); }
/* decoração dos mapas de entorno (Prédio, Lançamento): fn(H, {center: [lng, lat], radius (km), view}) — ex.: ícones de equipamentos */
function registerMapDecor(fn) { REG.decor.push(fn); }
function decorate(H, ctx) { if (H && H.ready) REG.decor.forEach(fn => safe('decoração do mapa', () => fn(H, ctx))); }
const LAYER_GROUPS = ['Mercado secundário', 'Mercado primário', 'Terrenos', 'Aluguel', 'Contexto', 'Outros'];
function defaultCam() {
  const c = new Set();
  REG.layers.forEach(l => { if (l.def) { c.add(l.id); (l.subs || []).forEach(s => { if (s.def !== false) c.add(l.id + ':' + s.id); }); } else (l.subs || []).forEach(s => { if (s.def !== false) c.add(l.id + ':' + s.id); }); });
  return c;
}
const camHas = id => !!(S.cam && S.cam.has(id));

/* ── URL: #/{vista}[/{id}…]?{parâmetros} — só vai o que difere do padrão ── */
const CORE_PARAMS = [
  {k: 't', get: () => S.tipo, set: v => { S.tipo = v; }, def: 'apto'},
  {k: 'd', get: () => S.dim, set: v => { S.dim = v; }, def: 'area'},
  {k: 'f', get: () => S.fx, set: v => { S.fx = v; }, def: '*'},
  {k: 'cor', get: () => S.met, set: v => { S.met = v; }, def: 'preco', views: ['cidade']},
  {k: 'cam', get: () => [...(S.cam || defaultCam())].sort().join(','), set: v => { S.cam = new Set(v ? v.split(',').filter(Boolean) : []); },
    def: () => [...defaultCam()].sort().join(','), views: ['cidade']},
  {k: 'anos', get: () => String(S.years), set: v => { S.years = +v || 10; }, def: '10', views: ['distrito']},
  {k: 'raio', get: () => String(S.radius), set: v => { S.radius = +v || 1; }, def: '1', views: ['predio']},
  {k: 'jan', get: () => String(S.compYears), set: v => { S.compYears = +v || 2; }, def: '2', views: ['predio']},
  {k: 'qmin', get: () => String(S.qmin), set: v => { S.qmin = +v || 30; }, def: '30', views: ['quadrante']},
];
const allParams = () => CORE_PARAMS.concat(REG.params);
const pdef = p => String(typeof p.def === 'function' ? p.def() : p.def);
const inView = p => !p.views || p.views.includes(S.view);
function hashFromState() {
  const v = viewDef(S.view) || {ids: []};
  const ids = (v.ids || []).map(k => S[k]);
  const path = '/' + [S.view].concat(ids.every(x => x != null && x !== '') ? ids.map(x => encodeURIComponent(x)) : []).join('/');
  const qs = allParams().filter(inView).map(p => [p.k, p.get(), pdef(p)]).filter(([, val, d]) => val != null && String(val) !== d)
    .map(([k, val]) => k + '=' + encodeURIComponent(val)).join('&');
  return path + (qs ? '?' + qs : '');
}
function stateFromHash() {
  const h = decodeURI(location.hash.replace(/^#/, '')).replace(/^%2F/i, '/');
  if (!h) return false;
  if (!h.startsWith('/')) { S.view = viewOn(h) ? h : 'cidade'; return true; }   // links antigos (#cidade)
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(x => decodeURIComponent(x));
  if (parts[0] && viewOn(parts[0])) {   // id ausente no caminho: as vistas do núcleo guardam o último; as de módulo fecham a entidade
    S.view = parts[0]; const v = viewDef(parts[0]);
    (v.ids || []).forEach((k, i) => { if (parts[i + 1] != null) S[k] = parts[i + 1]; else if (!v.keepIds) S[k] = null; });
  } else if (parts[0] && DISABLED.has(parts[0])) S.view = 'cidade';
  const q = new URLSearchParams(qs || '');
  allParams().forEach(p => { if (q.has(p.k)) p.set(q.get(p.k)); else if (inView(p)) p.set(pdef(p)); });
  return true;
}
let navPush = false, lastHash = null, STARTED = false;
function syncUrl() {
  const h = '#' + hashFromState();
  if (location.hash !== h) { if (navPush) history.pushState(null, '', h); else history.replaceState(null, '', h); }
  lastHash = location.hash; navPush = false;
}
const onNav = () => { if (location.hash === lastHash) return; stateFromHash(); render(); };
window.addEventListener('popstate', onNav);
window.addEventListener('hashchange', onNav);
/* navegação (drill-down, clique no mapa ou na tabela) empilha no histórico: o Voltar desfaz.
   opt.keep: troca de entidade dentro da mesma aba (ex.: outro lançamento pelo ranking) sem rolar ao topo */
function setView(v, ids, opt) {
  if (DISABLED.has(v)) { toast('Esta aba está desligada por enquanto.'); return; }
  const troca = v !== S.view;
  S.view = v; if (ids) Object.assign(S, ids); navPush = true; render();
  // rola ao topo só quando a PÁGINA muda (30/09): clicar num lote ou distrito no mapa da Cidade não mexe na rolagem
  if (troca && !(opt && opt.keep)) window.scrollTo({top: 0});
}
function openDist(cd) { setView('distrito', {cd}); }
function openLot(cd, id) { setView('predio', {lotCd: cd, lot: id}); }

/* ── controles ─────────────────────────────────────────── */
/* o que o tema aceita no estrato: {tipos, dims, quartos: tipos com Quartos (padrão só apto), why} */
/* dimensões que o TIPO aceita (I-036): terreno só tamanho (m² de terreno); vaga só padrão e idade; quartos só apto.
   O tema (vista de módulo) pode restringir mais, nunca ampliar. */
const estratoOf = () => {
  const E = (viewDef(S.view) || {}).estrato || {}, dimsT = DIMS_T[S.tipo] || ['area', 'padrao', 'idade', 'quartos'];
  return {tipos: E.tipos || TIPOS, dims: E.dims ? E.dims.filter(d => dimsT.includes(d)) : dimsT, quartos: E.quartos || ['apto'], why: E.why};
};
function fixEstrato() {
  if (!TIPOS.includes(S.tipo)) S.tipo = TIPOS[0];
  let E = estratoOf();
  if (E.tipos.length && !E.tipos.includes(S.tipo)) { S.tipo = E.tipos[0]; E = estratoOf(); }   // tema sem estrato (tipos/dims vazios): não mexe
  const dimOk = d => E.dims.includes(d) && (d !== 'quartos' || E.quartos.includes(S.tipo));
  if (E.dims.length && !dimOk(S.dim)) { const d = E.dims.find(dimOk) || 'area'; if (d !== S.dim) { S.dim = d; S.fx = '*'; } }
  if (S.fx !== '*' && !FXD(S.dim).includes(S.fx)) S.fx = '*';   // faixa de outro tipo (ex.: "≤45" ao trocar para terreno)
}
$('tipoSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; S.tipo = b.dataset.t; fixEstrato(); render(); });
$('dimSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; if (S.dim !== b.dataset.d) { S.dim = b.dataset.d; S.fx = '*'; } render(); });
$('fxChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.fx = b.dataset.f; render(); });
$('qminSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.qmin = +b.dataset.n; render(); });
$('qCI').addEventListener('change', e => { S.qCI = e.target.checked; render(); });
$('qLab').addEventListener('change', e => { S.qLab = e.target.checked; render(); });
$('rangeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.years = +b.dataset.y; render(); });
$('cityRef').addEventListener('change', e => { S.cityRef = e.target.checked; render(); });
$('distSel').addEventListener('change', e => { S.cd = e.target.value; render(); });
$('bldSearch').addEventListener('input', () => renderBldTable());
$('dtMet').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (!b) return; S.dtMet = b.dataset.m; renderDistTip(); });
$('dtSearch').addEventListener('input', () => renderDistTip());
$('bldOnlyStr').addEventListener('change', e => { S.bldOnlyStr = e.target.checked; renderBldTable(); });
$('radius').addEventListener('input', e => { S.radius = +e.target.value; renderComps(); syncUrl(); });
$('compYears').addEventListener('change', e => { S.compYears = +e.target.value; renderComps(); syncUrl(); });
$('nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
/* mapa de calor: a roda do mouse rola a PÁGINA. O dataZoom "inside" do ECharts engole a roda (preventDefault) mesmo com zoom e
   movimento pela roda desligados; parar a propagação na captura, antes de chegar ao zrender, devolve a rolagem ao navegador */
['wheel', 'mousewheel'].forEach(ev => $('exclHeat').addEventListener(ev, e => e.stopPropagation(), {capture: true, passive: true}));
/* altura do cabeçalho fixo (quebra em 2 linhas em telas médias): o menu lateral gruda logo abaixo dele, sem ficar por baixo */
const HDR = document.querySelector('header.top');
if (HDR && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--hh', HDR.offsetHeight + 'px')).observe(HDR);

/* menu lateral montado do registro: Geografia (macro → micro) e Radares (um tema cada) */
function buildRail() {
  const vis = REG.views.filter(v => !DISABLED.has(v.id));
  const geo = vis.filter(v => v.group === 'geo').sort(byOrder), rad = vis.filter(v => v.group !== 'geo').sort(byOrder);
  const btn = v => `<button type="button" data-view="${esc(v.id)}"><span>${esc(v.label)}</span><small>${esc(v.sub || '')}</small></button>`;
  $('railViews').innerHTML = `<div class="railgrp">Geografia</div>${geo.map(btn).join('')}<div class="scale" aria-hidden="true">Do macro ao micro<div class="bar"></div>cidade → prédio</div>` +
    (rad.length ? `<div class="railgrp">Radares</div>${rad.map(btn).join('')}` : '');
}
function syncControls() {
  document.querySelectorAll('#nav button[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === S.view ? 'page' : 'false'));
  const V = viewDef(S.view) || {}, E = estratoOf();
  fixEstrato();
  const tseg = $('tipoSeg'), thtml = TIPOS.map(t => `<button type="button" data-t="${esc(t)}">${esc(GRP_LB[t] || TIPO_LB[t] || t)}</button>`).join('');
  if (tseg._html !== thtml) { tseg.innerHTML = thtml; tseg._html = thtml; }
  document.querySelectorAll('#tipoSeg button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.t === S.tipo)); b.disabled = !E.tipos.includes(b.dataset.t); b.style.opacity = b.disabled ? .45 : ''; b.dataset.tt = b.disabled ? (E.why || 'não disponível neste tema') : (TIPO_TT[b.dataset.t] || ''); });
  document.querySelectorAll('#dimSeg button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.d === S.dim)); b.disabled = (b.dataset.d === 'quartos' && !E.quartos.includes(S.tipo)) || !E.dims.includes(b.dataset.d); b.style.opacity = b.disabled ? .45 : ''; });
  const cols = fxColors(S.dim);
  $('fxChips').innerHTML = `<button type="button" data-f="*" aria-pressed="${S.fx === '*'}" style="--c:${css('--ink')}"><i></i>Todas</button>` +
    FXD(S.dim).map((f, i) => `<button type="button" data-f="${esc(f)}" aria-pressed="${S.fx === f}" style="--c:${cols[i]}" title="${esc(fxLab(S.dim, f))}"><i></i>${esc(f)}${S.dim === 'area' ? ' m²' : ''}</button>`).join('');
  document.querySelectorAll('#qminSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.n === S.qmin)));
  document.querySelectorAll('#rangeSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.y === S.years)));
  $('qCI').checked = S.qCI; $('qLab').checked = S.qLab; $('cityRef').checked = S.cityRef;
  $('radius').value = S.radius; $('radiusVal').textContent = nf1.format(S.radius) + ' km'; $('compYears').value = S.compYears; $('bldOnlyStr').checked = S.bldOnlyStr;
  $('distSel').innerHTML = DCODES.slice().sort((a, b) => dname(a).localeCompare(dname(b), 'pt')).map(cd => `<option value="${cd}"${cd === S.cd ? ' selected' : ''}>${esc(dname(cd))}</option>`).join('');
  $('lastQ').textContent = `${fDate(Math.round((Date.parse(M.last_date) - Date.UTC(2006, 0, 1)) / 864e5))} (séries até ${M.last_q})`;
  const rn = typeof V.railNote === 'function' ? V.railNote() : V.railNote;
  const rl = typeof V.estratoLabel === 'function' ? V.estratoLabel() : sLabel();
  $('railNote').innerHTML = `Estrato ativo:<br><b>${esc(rl)}</b><br><span class="muted">${esc(rn || railNotePadrao())}</span>`;
  REG.views.forEach(v => { const el = $('v-' + v.id); if (el) el.hidden = v.id !== S.view; });
}
let lastView = null;
function render() {
  S.fromView = lastView; lastView = S.view;   // vista do render anterior: a vista sabe se a troca veio de dentro dela
  syncControls(); save(); syncUrl();
  const v = viewDef(S.view) || viewDef('cidade');
  safe('vista ' + v.id, () => v.render());
  renderFooter();
  publish();
}
/* Central (dashboard): embutido num iframe, a barra lateral e o estrato ativo são desenhados pelo
   dashboard a partir deste estado; cada render avisa com o evento 'radar:state' (mesma origem). */
const RAIL_NOTES = {m2c: 'R$/m² de área construída do IPTU (inclui áreas comuns; privativa ≈ construída ÷ 1,64, varia por prédio).',
  m2t: 'R$/m² de área do terreno (IPTU). Só terrenos com SQL próprio; glebas divididas podem trazer a área do todo.',
  unid: 'R$ por vaga: valor declarado da unidade autônoma de garagem. Vagas vendidas na mesma guia do apartamento não aparecem separadas.'};
const railNotePadrao = () => RAIL_NOTES[baseOf()] || RAIL_NOTES.m2c;
function radarState() {
  const vis = REG.views.filter(v => !DISABLED.has(v.id));
  const geo = vis.filter(v => v.group === 'geo').sort(byOrder), rad = vis.filter(v => v.group !== 'geo').sort(byOrder);
  const V = viewDef(S.view) || {};
  const rn = typeof V.railNote === 'function' ? V.railNote() : V.railNote;
  const rl = typeof V.estratoLabel === 'function' ? V.estratoLabel() : sLabel();
  return {view: S.view, estrato: rl, nota: rn || railNotePadrao(),
    views: geo.concat(rad).map(v => ({id: v.id, label: v.label, sub: v.sub || '', group: v.group === 'geo' ? 'geo' : 'radar'}))};
}
function publish() { try { window.dispatchEvent(new CustomEvent('radar:state', {detail: radarState()})); } catch (e) { /* sem ouvinte */ } }
/* seções e selos registrados por módulos, sempre depois do conteúdo do núcleo */
function renderSections(view, ctx) {
  const host = $('v-' + view); if (!host) return;
  (REG.sections[view] || []).forEach(sec => {
    let card = document.getElementById(`sec-${view}-${sec.id}`);
    if (!card) {
      card = document.createElement('div'); card.className = 'card modsec'; card.id = `sec-${view}-${sec.id}`;
      card.innerHTML = `<h3>${esc(sec.title || '')}</h3>${sec.sub ? `<p class="sub">${esc(sec.sub)}</p>` : ''}<div class="secbody"></div>`;
      host.appendChild(card);
    }
    safe(`seção ${view}/${sec.id}`, () => { const r = sec.render(card.querySelector('.secbody'), ctx, card); card.hidden = r === false; });
  });
}
const badgesHtml = (view, ctx) => (REG.badges[view] || []).map(fn => { try { return fn(ctx) || ''; } catch (e) { logErr('selo: ' + e); return ''; } }).join('');
/* JSON auxiliar servido pelo serve.py (nunca embutido no HTML: dados de fonte licenciada são de uso interno) */
const JCACHE = {};
function loadJSON(path) {
  if (JCACHE[path]) return JCACHE[path];
  const base = /^https?:$/.test(location.protocol) ? '' : 'http://127.0.0.1:8766/';
  return JCACHE[path] = fetch(base + path).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + path); return r.json(); })
    .catch(e => { delete JCACHE[path]; throw e; });
}

/* ── pequenos componentes ───────────────────────────────── */
const nBadge = n => n == null ? '' : `<span class="qtag">n=${nf0.format(n)}</span>`;
function priceCell(x, lo = LOT_SCALE[baseOf()][0], hi = LOT_SCALE[baseOf()][1]) {
  if (!x || !x.n) return '<span class="gray">sem venda</span>';
  const L = v => clamp((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)), 0, 1) * 100;
  const bar = `<span class="rangebar"><span class="tr"></span><span class="iq" style="left:${L(x.a)}%;width:${Math.max(2, L(x.b) - L(x.a))}%"></span><span class="md" style="left:${L(x.m)}%"></span></span>`;
  return x.ok ? `${bar}${nf0.format(x.m)}${nBadge(x.n)}` : `<span class="gray" title="n abaixo do mínimo (${MIN})">${bar}${nf0.format(x.m)}${nBadge(x.n)}</span>`;
}
const dvCell = dv => dv == null ? '<span class="gray" title="n abaixo do mínimo em um dos períodos">—</span>' :
  `<span class="${dv.sig ? 'sig' : ''}" title="IC95%: ${fSig(dv.lo)} a ${fSig(dv.hi)}${dv.sig ? '' : ' (inclui zero: não significativo)'}">${fSig(dv.v)}</span> <span class="ci">[${nf0.format(dv.lo)}; ${nf0.format(dv.hi)}]</span>`;
const kpi = (l, v, d) => `<div class="kpi"><span class="l">${l}</span><span class="v">${v}</span><span class="d">${d || ''}</span></div>`;
function qAxis(q0) { return Q.slice(q0); }
function winStart() { return Math.max(QF, NQ - S.years * 4); }

/* ════════ CIDADE ════════════════════════════════════════ */
let MC = null; const MCS = {labels: [], fitted: false, lotsCds: []};
function distColorFn() {
  const stats = DCODES.map(geoStats).filter(Boolean);
  const vals = stats.map(s => s.x && s.x.ok ? s.x.m : null).filter(v => v != null).sort((a, b) => a - b);
  const lo = qt(vals, 0.05) || 1500, hi = qt(vals, 0.95) || 15000;
  const exs = stats.map(s => s.excl).filter(v => v != null);
  const vv = stats.map(s => s.x ? s.x.n : 0).filter(Boolean);
  const gg = stats.map(s => s.giro).filter(v => v != null);
  const f = {
    preco: s => s.x && s.x.ok ? priceColor(s.x.m, lo, hi) : null,
    var: s => s.dv ? varColor(s.dv.v, 15) : null,
    vol: s => s.x && s.x.n ? ramp(RAMP[mode()].seq, Math.sqrt(s.x.n) / Math.sqrt(Math.max(...vv))) : null,
    giro: s => s.giro != null ? ramp(RAMP[mode()].seq, (s.giro - (qt(gg, .05) || 0)) / ((qt(gg, .95) || 8) - (qt(gg, .05) || 0))) : null,
    excl: s => s.excl != null ? heatColor(s.excl, 0, Math.max(60, qt(exs, 0.95) || 60)) : null,
  }[S.met];
  return {stats, f, lo, hi, exMax: Math.max(60, qt(exs, 0.95) || 60), vmax: Math.max(...vv), glo: qt(gg, .05) || 0, ghi: qt(gg, .95) || 8};
}
const metLabel = s => ({preco: s.x && s.x.n ? fPrice(s.x.m) : 'sem venda', var: s.dv ? fSig(s.dv.v) : '—', vol: s.x ? nf0.format(s.x.n) : '0',
  giro: s.giro != null ? nf1.format(s.giro) + '%' : '—', excl: s.excl != null ? nf0.format(s.excl) + '%' : '—'})[S.met];
function distTip(s) {
  const x = s.x;
  return tip(s.name, [
    [`${PU()} 12 m · ${sLabel()}`, x && x.n ? `${fPrice(x.m)}${x.ok ? '' : ' (n baixo)'}` : 'sem venda'],
    ['Faixa interquartil', x && x.n ? `${nf0.format(x.a)} – ${nf0.format(x.b)}` : '—'],
    ['IC95% da mediana', x && x.ok ? `${nf0.format(x.lo)} – ${nf0.format(x.hi)}` : '—'],
    ['n (vendas do estrato, 12 m)', x ? nf0.format(x.n) : '0'],
    ['Variação 12 m', s.dv ? `${fSig(s.dv.v)} [${nf0.format(s.dv.lo)}; ${nf0.format(s.dv.hi)}]` : '—'],
    ['Vendas SQL próprio (12 m)', nf0.format(s.own) + ' · ' + fMi(s.rv)],
    ['Planta (12 m)', nf0.format(s.pl) + ' unidades'],
    [`Giro ${LAST_FULL_Y}`, s.giro != null ? nf1.format(s.giro) + '% do estoque de aptos' : '—'],
    [`Fora do preço ${LAST_FULL_Y}`, s.excl != null ? nf0.format(s.excl) + '% (planta ' + nf0.format(s.exclPl) + '%)' : '—']],
    'clique para abrir o distrito');
}
/* cor dos distritos = UMA métrica (núcleo ITBI ou de módulo) ou nenhuma; as camadas por cima usam forma/contorno/tamanho */
const CORE_METS = [
  {id: 'preco', label: () => PU() + ' (12 m)', title: 'Preço mediano de 12 meses do estrato selecionado, na base do tipo (m² construído, m² de terreno ou unidade)'},
  {id: 'var', label: 'Variação 12 m', title: 'Mediana dos últimos 12 meses contra os 12 anteriores (IC95%)'},
  {id: 'vol', label: 'Vendas (12 m)', title: 'Negócios do estrato em 12 meses'},
  {id: 'giro', label: 'Giro', title: 'Apartamentos vendidos no ano ÷ estoque de apartamentos do IPTU'},
  {id: 'excl', label: '% fora do preço', title: 'Vendas que não entram no R$/m² (planta + sinalizadas)'},
];
const PALS = {seq: () => RAMP[mode()].seq, div: () => DIVL[mode()], heat: () => HEAT, alug: () => VIOLET[mode()], pl: () => ORANGE[mode()]};
function metricPaint() {
  if (S.met === 'none') return {none: true, color: () => null, label: () => '', tipOf: cd => distTip(geoStats(cd)),
    legend: `<span class="it muted">Cor dos distritos desligada (só o contorno): uma escala contínua por vez</span>`};
  if (CORE_METS.some(m => m.id === S.met)) {
    const C = distColorFn(), by = Object.fromEntries(C.stats.map(z => [z.cd, z]));
    return {color: cd => by[cd] ? C.f(by[cd]) : null, label: cd => by[cd] ? metLabel(by[cd]) : '', tipOf: cd => distTip(geoStats(cd)), legend: coreLegend(C)};
  }
  const m = REG.metrics.find(x => x.id === S.met);
  if (!m) { S.met = 'preco'; return metricPaint(); }
  const ok = cd => (m.ok ? m.ok(cd) : true);
  const vals = DCODES.map(cd => (ok(cd) ? m.value(cd) : null)).filter(v => v != null && (!m.log || v > 0)).sort((x, y) => x - y);
  const [lo, hi] = m.domain ? m.domain(vals) : [qt(vals, 0.05), qt(vals, 0.95)];
  const stops = (PALS[m.palette || 'seq'] || PALS.seq)();
  const t = v => (m.log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / ((hi - lo) || 1));
  const fmt = m.fmt || (v => nf1.format(v));
  return {
    color: cd => { if (!ok(cd)) return null; const v = m.value(cd); return v == null || (m.log && v <= 0) || lo == null ? null : ramp(stops, t(v)); },
    label: cd => { const v = m.value(cd); return v == null ? '' : fmt(v) + (ok(cd) ? '' : ' (n baixo)'); },
    tipOf: cd => (m.tip && m.tip(cd)) || distTip(geoStats(cd)),
    legend: lo == null ? `<span class="it muted">${esc(m.label)}: sem dados</span>` :
      `<span class="scale"><b style="font-weight:500;color:var(--ink)">${esc(m.legendLabel ? m.legendLabel() : m.label)}</b> ${esc(fmt(lo))}<span class="g" style="background:${gradCss(stops)}"></span>${esc(fmt(hi))}${m.log ? ' (log)' : ''}</span>`,
  };
}
function coreLegend(C) {
  const lab = {preco: PU() + ' 12 m', var: 'Variação 12 m', vol: 'Vendas do estrato, 12 m', giro: `Giro ${LAST_FULL_Y}`, excl: `% fora do preço ${LAST_FULL_Y}`}[S.met];
  const grad = S.met === 'var' ? gradCss(DIVL[mode()]) : S.met === 'excl' ? gradCss(HEAT) : gradCss(RAMP[mode()].seq);
  const ends = {preco: [nf0.format(C.lo), nf0.format(C.hi) + ' (escala log)'], var: ['−15%', '+15%'], vol: ['0', nf0.format(C.vmax)], giro: [nf1.format(C.glo) + '%', nf1.format(C.ghi) + '%'], excl: ['0%', nf0.format(C.exMax) + '%']}[S.met];
  return `<span class="scale"><b style="font-weight:500;color:var(--ink)">${lab}</b> ${ends[0]}<span class="g" style="background:${grad}"></span>${ends[1]}</span>`;
}
function applyCity() {
  const H = MC; if (!H || !H.ready) return;
  const map = H.map, below = firstSymbol(map), P = metricPaint();
  const fc = {type: 'FeatureCollection', features: DF.map(f => { const c = P.none ? null : P.color(f.properties.cd);
    return {type: 'Feature', geometry: f.geometry, properties: {cd: f.properties.cd, fc: c || css('--gray-cell'), gray: c ? 0 : 1, none: P.none ? 1 : 0}}; })};
  upsertSrc(map, 'app-dist', fc);
  addLayerOnce(map, {id: 'app-dist-fill', type: 'fill', source: 'app-dist', paint: {'fill-color': ['get', 'fc']}}, below);
  addLayerOnce(map, {id: 'app-dist-line', type: 'line', source: 'app-dist', layout: {'line-join': 'round'}, paint: {}}, below);
  map.setPaintProperty('app-dist-fill', 'fill-opacity', P.none ? 0 : ['interpolate', ['linear'], ['zoom'], 10, 0.72, 13, 0.42, 15, 0.12]);
  map.setPaintProperty('app-dist-line', 'line-color', P.none ? css('--ink-2') : css('--surface'));
  map.setPaintProperty('app-dist-line', 'line-opacity', P.none ? 0.55 : 1);
  map.setPaintProperty('app-dist-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2.2]);
  upsertSrc(map, 'app-lots', MCS.lotsFC || EMPTY_FC);
  addLayerOnce(map, {id: 'app-lots-fill', type: 'fill', source: 'app-lots', minzoom: 13, paint: {'fill-color': ['get', 'fc'], 'fill-opacity': ['case', ['==', ['get', 'm'], 1], 0.88, 0.25]}});
  addLayerOnce(map, {id: 'app-lots-line', type: 'line', source: 'app-lots', minzoom: 13, paint: {'line-width': ['case', ['==', ['get', 'pl'], 1], 1.6, 0.5]}});
  map.setPaintProperty('app-lots-line', 'line-color', ['case', ['==', ['get', 'pl'], 1], css('--pl'), css('--ink-2')]);
  map.setPaintProperty('app-lots-line', 'line-opacity', ['case', ['==', ['get', 'm'], 1], 0.9, 0.35]);
  // realce da rua buscada (30/09) e do lote aberto no cartão
  addLayerOnce(map, {id: 'app-lots-hl', type: 'line', source: 'app-lots', minzoom: 13, filter: ['==', ['get', 'hl'], 1], paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 16, 3]}});
  map.setPaintProperty('app-lots-hl', 'line-color', css('--ink'));
  upsertSrc(map, 'app-lot-sel', LC.fc || EMPTY_FC);
  addLayerOnce(map, {id: 'app-lot-sel', type: 'line', source: 'app-lot-sel', paint: {'line-width': 3.2}});
  map.setPaintProperty('app-lot-sel', 'line-color', css('--ink'));
  const lotsOn = camHas('lotes') || camHas('planta');
  visL(map, 'app-lots-fill', lotsOn); visL(map, 'app-lots-line', lotsOn); visL(map, 'app-lots-hl', lotsOn);
  // camadas dos módulos (a ordem de desenho é de cada um: preenchimentos abaixo dos rótulos, glifos por cima)
  REG.layers.filter(l => !l.core).forEach(l => safe('camada ' + l.id, () => {
    if (l.add) l.add(H, below);
    if (l.update) l.update(H);
    if (l.setVisible) l.setVisible(H, camHas(l.id));
  }));
}
function cityLabels() {
  const H = MC; if (!H) return;
  MCS.labels.forEach(l => l.m.remove());
  const P = metricPaint();
  MCS.labels = DCODES.map(cd => { const p = DIST[cd], s = geoStats(cd); if (!p || !s) return null; const el = document.createElement('div'); el.className = 'bm-label';
    const lb = P.label(cd); el.innerHTML = `${esc(p.nome)}${lb ? `<small>${esc(lb)}</small>` : ''}`; return {s, el, m: new maplibregl.Marker({element: el}).setLngLat(p.lab).addTo(H.map)}; }).filter(Boolean);
  cityDeclutter();
}
function cityDeclutter() {
  const H = MC; if (!H) return; const z = H.map.getZoom(), boxes = [];
  MCS.labels.slice().sort((a, b) => (b.s.x ? b.s.x.n : 0) - (a.s.x ? a.s.x.n : 0)).forEach(l => {
    const p = H.map.project(l.m.getLngLat()), w = l.el.offsetWidth / 2 + 3, h = l.el.offsetHeight / 2 + 2, bx = [p.x - w, p.y - h, p.x + w, p.y + h];
    const hit = z >= 14 || boxes.some(b => !(bx[2] < b[0] || bx[0] > b[2] || bx[3] < b[1] || bx[1] > b[3]));
    l.el.classList.toggle('off', hit); if (!hit) boxes.push(bx);
  });
}
/* lotes com venda: carregados por distrito quando o zoom passa de 13 */
let lotTimer = 0;
function cityLotsLoad() {
  clearTimeout(lotTimer);
  lotTimer = setTimeout(() => {
    const H = MC; if (!H || !H.ready) return;
    const map = H.map; if (map.getZoom() < 13 || !(camHas('lotes') || camHas('planta'))) { MCS.lotsCds = []; cityLotsRefresh(); return; }
    const b = map.getBounds(), bb = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const cds = DCODES.filter(cd => { const q = DIST[cd].bb; return !(q[2] < bb[0] || q[0] > bb[2] || q[3] < bb[1] || q[1] > bb[3]); }).slice(0, 8);
    MCS.lotsCds = cds;
    H.setMsgExt && H.setMsgExt('Carregando lotes…');
    Promise.allSettled(cds.map(fetchDist)).then(rs => { cityLotsRefresh(); const bad = rs.filter(r => r.status === 'rejected').length;
      $('mapLegend').dataset.err = bad ? '1' : ''; if (bad) renderCityLegend(`<span class="it muted">Lotes indisponíveis: abra pela URL do serve.py (dist/*.json não carrega via file://).</span>`); });
  }, 250);
}
function lotColorScale() { return LOT_SCALE[baseOf()] || LOT_SCALE.m2c; }
function cityLotsRefresh() {
  const H = MC; if (!H || !H.ready) return;
  const [lo, hi] = lotColorScale(), feats = [], showL = camHas('lotes'), showP = camHas('planta');
  for (const cd of MCS.lotsCds) {
    const F = DFILE[cd]; if (!F) continue;
    for (const l of F.lots) {
      const isPl = l.pl > 0 && l.pl >= l.n * 0.5;
      const match = grpOf(l.t) === S.tipo;
      if (isPl ? !showP : !showL) continue;
      feats.push({type: 'Feature', geometry: lotFeature(l), properties: {cd, i: l.i, m: match || isPl ? 1 : 0, pl: l.pl > 0 ? 1 : 0, hl: ruaHas(cd, l.i) ? 1 : 0,
        fc: isPl ? css('--pl') : l.p && match ? priceColor(l.p[2], lo, hi) : css('--gray-cell')}});
    }
  }
  MCS.lotsFC = {type: 'FeatureCollection', features: feats};
  const s = H.map.getSource('app-lots'); if (s) s.setData(MCS.lotsFC);
  visL(H.map, 'app-lots-fill', showL || showP); visL(H.map, 'app-lots-line', showL || showP); visL(H.map, 'app-lots-hl', showL || showP);
}
function lotTip(l) {
  const u = l.u, p = l.p, g = grpOf(l.t) || S.tipo;
  const rows = [['Tipo predominante', TIPO_LB[l.t] || l.t], ['Negócios (todos / 5 anos)', `${nf0.format(l.n)} / ${nf0.format(l.n5)}`],
    [`${PU(g)} 5 anos (mediana)`, p ? `${fPrice(p[2], g)} · IQR ${nf0.format(p[1])}–${nf0.format(p[3])} · n=${p[0]}` : 'sem venda elegível'],
    ['Última venda', fDate(l.d2)]];
  if (u) rows.push([`Cadastro (IPTU ${M.iptu_perfil || ''})`, `${nf0.format(u[0])} unid.${u[1] ? ' · ' + nf0.format(u[1]) + ' aptos' : ''}${u[3] ? ' · ' + u[3] + ' pav.' : ''}${u[4] ? ' · ACC ' + u[4] : ''}`]);
  if (l.pl) rows.push(['Planta', nf0.format(l.pl) + ' unidades vendidas sobre o terreno']);
  if (l.qa) rows.push(['Anúncios QuintoAndar', `${l.qa.ns} venda · ${l.qa.nr} aluguel`]);
  return tip(l.nm || l.end || 'Lote ' + l.id, rows, (l.nm && l.end ? l.end + ' · ' : '') + 'clique para ver as vendas do lote');
}
function renderCityLegend(extra) {
  const P = metricPaint(), lg = [P.legend];
  if (!P.none) lg.push(`<span class="it"><i class="dot" style="border-radius:2px;background:var(--gray-cell)"></i>n abaixo do mínimo (cinza)</span>`);
  REG.layers.slice().sort(layerSort).forEach(l => { if (!camHas(l.id)) return; const h = l.legend ? (() => { try { return l.legend(); } catch (e) { logErr('legenda ' + l.id + ': ' + e); return ''; } })() : ''; if (h) lg.push(h); });
  if (extra) lg.push(extra);
  $('mapLegend').innerHTML = lg.join('');
}
const layerSort = (a, b) => (LAYER_GROUPS.indexOf(a.group) - LAYER_GROUPS.indexOf(b.group)) || byOrder(a, b);
/* ── vistas prontas + cor (faixa acima do mapa) e painel de camadas (sobre o mapa) ── */
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
/* camadas ligadas (sem as sub-opções); as sub-opções só contam para camadas ligadas */
const layersOn = cam => new Set([...cam].filter(x => !x.includes(':')));
function currentPreset() {
  return REG.presets.find(p => p.met === S.met && sameSet(layersOn(new Set(p.cam)), layersOn(S.cam)) && p.cam.filter(x => x.includes(':')).every(x => S.cam.has(x)));
}
/* aplica a vista pronta: liga/desliga camadas; guarda as escolhas de sub-opção; camada que acende sem nenhuma sub usa as padrão */
function applyPreset(id) {
  const p = REG.presets.find(x => x.id === id); if (!p) return;
  const cam = new Set([...S.cam].filter(x => x.includes(':')));
  p.cam.forEach(x => cam.add(x));
  REG.layers.forEach(l => { if (cam.has(l.id) && (l.subs || []).length && !(l.subs || []).some(s => cam.has(l.id + ':' + s.id)))
    l.subs.forEach(s => { if (s.def !== false) cam.add(l.id + ':' + s.id); }); });
  S.met = p.met; S.cam = cam; S.soloPrev = null; render();
}
/* vistas prontas sem dado disponível nesta versão (os módulos seguem carregados, só saem da faixa) */
const PRESETS_OCULTOS = new Set(['terrenos', 'contexto']);
function renderCityCtrl() {
  const cur = currentPreset();
  const pres = REG.presets.filter(p => !PRESETS_OCULTOS.has(p.id)).sort(byOrder).map(p => `<button type="button" data-preset="${esc(p.id)}" aria-pressed="${cur && cur.id === p.id}" title="${esc(p.title || '')}">${esc(p.label)}</button>`).join('');
  const groups = [['Preço e liquidez (ITBI)', CORE_METS.map(m => Object.assign({group: 'Preço e liquidez (ITBI)'}, m))]];
  const mods = REG.metrics.slice().sort(byOrder);
  [...new Set(mods.map(m => m.group))].forEach(g => groups.push([g, mods.filter(m => m.group === g)]));
  const mbtn = m => `<button type="button" data-m="${esc(m.id)}" aria-pressed="${S.met === m.id}" title="${esc(m.title || '')}">${esc(typeof m.label === 'function' ? m.label() : m.label)}</button>`;
  $('cityCtrl').innerHTML = `<div class="cgrp"><span class="lab">Vista</span><div class="seg vchips">${pres}</div>${cur ? '' : '<span class="muted custom">vista personalizada</span>'}</div>` +
    `<span class="vsep" aria-hidden="true"></span>` +
    `<div class="cgrp"><span class="lab">Cor do distrito</span>` + groups.map(([g, ms]) => `<div class="seg" title="${esc(g)}">${ms.map(mbtn).join('')}</div>`).join('') +
    `<div class="seg"><button type="button" data-m="none" aria-pressed="${S.met === 'none'}" title="Só o contorno dos distritos">nenhuma</button></div></div>`;
}
$('cityCtrl').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.preset) { applyPreset(b.dataset.preset); return; }
  if (b.dataset.m) setMetric(b.dataset.m);
});
function setMetric(id) {
  const prevMet = S.met; S.met = id;
  const fills = id === 'none' ? [] : REG.layers.filter(l => l.fill && camHas(l.id));
  if (fills.length) { const prevCam = new Set(S.cam); fills.forEach(l => S.cam.delete(l.id)); toast(`${fills.map(l => l.label).join(', ')} desligada: uma escala contínua por vez`, () => { S.met = prevMet; S.cam = prevCam; render(); }); }
  render();
}
function setLayer(id, on) {
  const L = REG.layers.find(l => l.id === id.split(':')[0]);
  if (on) S.cam.add(id); else S.cam.delete(id);
  if (on && L && !id.includes(':') && (L.subs || []).length && !L.subs.some(s => S.cam.has(id + ':' + s.id)))
    L.subs.forEach(s => { if (s.def !== false) S.cam.add(id + ':' + s.id); });   // camada acende sem sub-opção: usa as padrão
  S.soloPrev = null;
  if (on && L && L.fill && !id.includes(':') && S.met !== 'none') {
    const prev = S.met; S.met = 'none';
    toast('Cor dos distritos desligada: uma escala contínua por vez', () => { S.met = prev; S.cam.delete(id); render(); });
  }
  render();
}
function soloLayer(id) {
  if (S.soloPrev && [...S.cam].every(x => x === id || x.startsWith(id + ':'))) { S.cam = new Set(S.soloPrev); S.soloPrev = null; }
  else { S.soloPrev = [...S.cam]; S.cam = new Set([...S.cam].filter(x => x === id || x.startsWith(id + ':'))); S.cam.add(id); }
  render();
}
/* painel de camadas: à direita, recolhido ao abrir a página. É redesenhado a cada clique (o estado mora em S.cam),
   então guarda a rolagem e o foco de antes e os devolve depois (senão a lista volta ao topo a cada clique). */
function renderLayerPanel() {
  const H = MC; if (!H) return;
  let el = H.host.querySelector('.lyp');
  if (!el) {
    el = document.createElement('div'); el.className = 'lyp closed'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Camadas do mapa');
    H.host.appendChild(el);
    el.addEventListener('change', e => { const c = e.target.closest('input[data-ly]'); if (c) setLayer(c.dataset.ly, c.checked); });
    el.addEventListener('click', e => {
      const s = e.target.closest('button[data-solo]'); if (s) { soloLayer(s.dataset.solo); return; }
      if (e.target.closest('.lyp-h')) { el.classList.toggle('closed'); const h = el.querySelector('.lyp-h'); if (h) h.setAttribute('aria-expanded', String(!el.classList.contains('closed'))); }
    });
  }
  const prevBody = el.querySelector('.lyp-b'), keepTop = prevBody ? prevBody.scrollTop : 0;
  const ae = document.activeElement, keepFocus = ae && el.contains(ae) ? (ae.dataset.ly ? `[data-ly="${CSS.escape(ae.dataset.ly)}"]` : ae.dataset.solo ? `[data-solo="${CSS.escape(ae.dataset.solo)}"]` : ae.classList.contains('lyp-h') ? '.lyp-h' : null) : null;
  const z = H.map.getZoom();
  const byG = {}; REG.layers.slice().sort(layerSort).forEach(l => { (byG[l.group] = byG[l.group] || []).push(l); });
  const row = l => {
    const on = camHas(l.id), far = l.minzoom && z < l.minzoom;
    const subs = (l.subs || []).map(s => `<label class="lyp-sub"><input type="checkbox" data-ly="${esc(l.id + ':' + s.id)}"${camHas(l.id + ':' + s.id) ? ' checked' : ''}${on ? '' : ' disabled'}> ${s.html || esc(s.label)}</label>`).join('');
    let note = ''; try { note = l.note ? l.note() || '' : ''; } catch (e) { logErr('nota ' + l.id + ': ' + e); }
    return `<div class="lyp-r${on ? ' on' : ''}"><label title="${esc(l.title || '')}"><input type="checkbox" data-ly="${esc(l.id)}"${on ? ' checked' : ''}> ${esc(l.label)}${l.minzoom ? ` <small class="${far ? 'far' : ''}">zoom ≥ ${l.minzoom}</small>` : ''}</label>` +
      `<button type="button" class="solo" data-solo="${esc(l.id)}" title="Só esta camada (2º clique restaura)" aria-label="Só ${esc(l.label)}">⊙</button></div>` +
      (subs ? `<div class="lyp-subs">${subs}</div>` : '') + (note ? `<div class="lyp-note">${note}</div>` : '');
  };
  const nOn = REG.layers.filter(l => camHas(l.id)).length;
  const html = `<button type="button" class="lyp-h" aria-expanded="${!el.classList.contains('closed')}"><span class="lyp-t"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 4 8l8 4 8-4-8-4ZM4 12l8 4 8-4M4 16l8 4 8-4"/></svg>Camadas${nOn ? ` <b>${nOn}</b>` : ''}</span><svg class="car" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="lyp-b">` +
    LAYER_GROUPS.filter(g => byG[g]).map(g => `<div class="lyp-g"><h5>${esc(g)}</h5>${byG[g].map(row).join('')}</div>`).join('') + `</div>`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  const nb = el.querySelector('.lyp-b'); if (nb && keepTop) nb.scrollTop = keepTop;
  if (keepFocus) { const f = el.querySelector(keepFocus); if (f) f.focus({preventScroll: true}); }
}
let toastTimer = 0;
function toast(msg, undo, hostEl) {
  const host = hostEl || (S.view === 'cidade' && MC ? MC.host : null) || document.body;
  let t = host.querySelector('.mtoast'); if (!t) { t = document.createElement('div'); t.className = 'mtoast'; t.setAttribute('role', 'status'); host.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">desfazer</button>' : ''}`;
  t.hidden = false;
  if (undo) t.querySelector('button').onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}
function renderCidade() {
  if (!MC) { MC = createBaseMap($('mapCity'), {layers: {predios: 'off', lotes: 'off'}, onStyle: applyCity}); if (MC) wireCity(); }
  renderCityCtrl();
  if (MC) { applyCity(); cityLabels(); cityLotsRefresh(); renderLayerPanel(); if (!MCS.fitted) { MCS.fitted = true; MC.fit({bounds: [[-46.83, -23.80], [-46.36, -23.36]], padding: 8, maxZoom: 12, pitch: 0, bearing: 0}); } }
  renderCityLegend();
  sizeCityMap();
  renderTraj('cityTraj', 'SP', true, $('trajLegend'));
  $('trajSub').textContent = `${GRP_LB[S.tipo] || TIPO_LB[S.tipo]} por ${DIMLB[S.dim]} · ${PU()}, mediana móvel de 12 meses. Faixa sombreada = IQR da faixa selecionada; tooltip com IC95% e n.`;
  volChart('cityVol', 'SP', QF);
  renderSections('cidade', {});
}
/* hover/clique: o dono da feição responde (lotes do núcleo ou a camada do módulo) */
const ownerOf = f => f && f.layer ? REG.layers.find(l => !l.core && l.hitLayers && l.hitLayers().includes(f.layer.id)) : null;
function wireCity() {
  const map = MC.map;
  wireMap(MC, {
    layers: () => ['app-lots-fill'].concat(...REG.layers.filter(l => !l.core && l.hitLayers && camHas(l.id)).map(l => l.hitLayers()).reverse()),
    tip: f => { const L = ownerOf(f); if (L) return L.tip ? L.tip(f) : null; const F = DFILE[f.properties.cd]; return F ? lotTip(F.lots[f.properties.i]) : null; },
    // clique num lote abre o CARTÃO sobre o mapa (30/09), não a página do Prédio; clique fora fecha o cartão antes de abrir o distrito
    click: f => { const L = ownerOf(f); if (L) { if (L.click) L.click(f); return; } const F = DFILE[f.properties.cd]; if (F) lotCard(f.properties.cd, F.lots[f.properties.i]); },
    hoverFallback: e => { if (map.getZoom() >= 14) return null; const t = MC.hit(['app-dist-fill'], e.point)[0]; return t ? metricPaint().tipOf(t.properties.cd) : null; },
    clickFallback: e => { if (LC.key) { lotCardClose(); return; } const t = MC.hit(['app-dist-fill'], e.point)[0]; if (t) openDist(t.properties.cd); },
  });
  map.on('move', rafThrottle(cityDeclutter));
  map.on('moveend', () => { cityLotsLoad(); REG.layers.forEach(l => { if (!l.core && l.onMove && camHas(l.id)) safe('camada ' + l.id, () => l.onMove(MC)); }); });
  map.on('zoomend', rafThrottle(renderLayerPanel));
}

/* trajetória por faixa (cidade ou distrito), com IQR da faixa em foco e cinza onde n < mínimo */
function renderTraj(id, cd, full, legendEl, q0 = QF) {
  const c = chart(id); if (!c) return;
  const X = Q.slice(q0), faixas = FXD(S.dim), cols = fxColors(S.dim);
  const focus = S.fx === '*' ? 'todos' : S.fx;
  const keys = [['todos', skey(S.tipo, S.dim, '*'), css('--ink')]].concat(faixas.map((f, i) => [f, skey(S.tipo, S.dim, f), cols[i]]));
  const series = [], gray = [];
  keys.forEach(([f, k, col]) => {
    const s = ser(cd, k, full); if (!s) return;
    const on = f === focus;
    const vals = X.map((_, j) => { const x = st(s, q0 + j); return x && x.ok ? x.m : null; });
    if (on) {
      const lo = X.map((_, j) => { const x = st(s, q0 + j); return x && x.ok ? x.a : null; });
      const hi = X.map((_, j) => { const x = st(s, q0 + j); return x && x.ok ? x.b - x.a : null; });
      series.push({type: 'line', stack: 'iqr', data: lo, symbol: 'none', lineStyle: {opacity: 0}, silent: true, z: 1});
      series.push({type: 'line', stack: 'iqr', data: hi, symbol: 'none', lineStyle: {opacity: 0}, areaStyle: {color: col, opacity: 0.16}, silent: true, z: 1});
    }
    series.push({name: f === 'todos' ? 'Todas' : f, type: 'line', data: vals, symbol: 'none', connectNulls: false, lineStyle: {width: on ? 2.6 : 1.3, color: col, opacity: on || focus === 'todos' ? 1 : 0.55}, itemStyle: {color: col}, z: on ? 5 : 3, _k: k});
    X.forEach((_, j) => { const x = st(s, q0 + j); if (x && x.n && !x.ok && on) gray.push([j, x.m, x.n]); });
  });
  if (cd !== 'SP' && S.cityRef) {
    const s = ser('SP', skey(), true);
    series.push({name: 'Cidade (mesmo estrato)', type: 'line', data: X.map((_, j) => { const x = st(s, q0 + j); return x && x.ok ? x.m : null; }), symbol: 'none', lineStyle: {width: 1.4, type: 'dashed', color: css('--muted')}, itemStyle: {color: css('--muted')}, z: 2, _k: 'city'});
  }
  if (gray.length) series.push({name: `n < ${MIN}`, type: 'scatter', data: gray.map(g => [g[0], g[1]]), symbolSize: 5, itemStyle: {color: css('--gray-cell'), borderColor: css('--muted')}, z: 6});
  const sAll = keys.map(([f, k, col]) => [f, ser(cd, k, full), col]);
  c.setOption(Object.assign(base(), {
    grid: {left: 58, right: 16, top: 12, bottom: 44},
    xAxis: ax({type: 'category', data: X, boundaryGap: false, axisLabel: {color: css('--muted'), fontSize: 10.5, interval: i => /^1T/.test(X[i]) && (+X[i].slice(-4)) % (X.length > 50 ? 2 : 1) === 0, formatter: v => v.slice(-4)}}),
    yAxis: ax({type: 'value', scale: true, axisLabel: {color: css('--muted'), fontSize: 10.5, formatter: v => nf0.format(v)}}),
    tooltip: Object.assign(base().tooltip, {trigger: 'axis', formatter: ps => {
      const j = ps[0].dataIndex, rows = [];
      sAll.forEach(([f, s, col]) => { const x = st(s, q0 + j); if (!x || !x.n) return;
        rows.push([`${f === 'todos' ? 'Todas' : fxLab(S.dim, f)}`, `${nf0.format(x.m)} · IQR ${nf0.format(x.a)}–${nf0.format(x.b)}${x.ok ? ` · IC ${nf0.format(x.lo)}–${nf0.format(x.hi)}` : ' · n baixo'} · n=${nf0.format(x.n)}`, col]); });
      if (cd !== 'SP' && S.cityRef) { const x = st(ser('SP', skey(), true), q0 + j); if (x && x.ok) rows.push(['Cidade (estrato)', nf0.format(x.m), css('--muted')]); }
      return tip(`${X[j]} · ${PU()}, 12 meses até o trimestre`, rows, `${dname(cd)} · ${GRP_LB[S.tipo] || TIPO_LB[S.tipo]}`);
    }}),
    dataZoom: q0 === QF ? [{type: 'inside', startValue: cd === 'SP' ? 0 : Math.max(0, winStart() - QF)}] : [],
    series,
  }), true);
  if (legendEl) legendEl.innerHTML = keys.map(([f, k, col]) => `<span class="it"><i class="lk" style="background:${col};height:${f === focus ? 3 : 2}px"></i>${f === 'todos' ? 'Todas' : esc(fxLab(S.dim, f))}</span>`).join('') +
    (cd !== 'SP' && S.cityRef ? `<span class="it"><i class="lk" style="background:var(--muted)"></i>cidade</span>` : '') + `<span class="it muted">cinza: n &lt; ${MIN}</span>`;
}
function volChart(id, cd, q0) {
  const c = chart(id); if (!c) return; const v = D.vol[cd], X = Q.slice(q0);
  c.setOption(Object.assign(base(), {
    grid: {left: 50, right: 12, top: 10, bottom: 40},
    xAxis: ax({type: 'category', data: X, axisLabel: {color: css('--muted'), fontSize: 10.5, interval: i => /^1T/.test(X[i]) && (+X[i].slice(-4)) % (X.length > 50 ? 2 : 1) === 0, formatter: v => v.slice(-4)}}),
    yAxis: ax({type: 'value', axisLabel: {color: css('--muted'), fontSize: 10.5, formatter: v => axM2(v)}}),
    tooltip: Object.assign(base().tooltip, {trigger: 'axis', formatter: ps => { const i = q0 + ps[0].dataIndex;
      return tip(`${Q[i]} · ${dname(cd)}`, [['SQL próprio', `${nf0.format(v.own[i])} · ${fMi(v.rv[i])}`, css('--s1')], ['Planta', `${nf0.format(v.pl[i])} · ${fMi(v.rvp[i])}`, css('--pl')], ['Em bloco (≥5 unid.)', nf0.format(v.bl[i])]], 'contagem de negócios (unidade = SQL + data + matrícula)'); }}),
    series: [{name: 'SQL próprio', type: 'bar', stack: 'v', data: v.own.slice(q0), itemStyle: {color: css('--s1')}, barCategoryGap: '20%'},
      {name: 'Planta', type: 'bar', stack: 'v', data: v.pl.slice(q0), itemStyle: {color: css('--pl')}}],
  }), true);
}

/* ════════ QUADRANTE ═════════════════════════════════════ */
const ZONA = {Centro: 0, Leste: 1, Norte: 2, Oeste: 3, Sul: 4};
const zonaCol = z => [css('--ink-2'), '#3f80d2', '#8d6bd1', '#e0a100', '#eb8a34'][ZONA[z] ?? 0];
function quadName(x, y, cx, cy) { return x >= cx ? (y >= cy ? 'Caro e acelerando' : 'Caro e desacelerando') : (y >= cy ? 'Barato e acelerando' : 'Barato e desacelerando'); }
function renderQuad() {
  const c = chart('quadChart'); if (!c) return;
  const sp = geoStats('SP'), cx = sp.x && sp.x.ok ? sp.x.m : null, cy = sp.dv ? sp.dv.v : null;
  const all = DCODES.map(geoStats).filter(s => s && s.x && s.x.n);
  const good = all.filter(s => s.x.n >= S.qmin && s.dv), weak = all.filter(s => !(s.x.n >= S.qmin && s.dv) && s.dv);
  const size = n => clamp(6 + Math.sqrt(n) * 0.9, 7, 42);
  const trail = S.qSel && D.recent[S.qSel] ? (() => { const s = ser(S.qSel, skey(), false); const pts = []; for (let i = LQ - 7; i <= LQ; i++) { const x = st(s, i), d = delta(s, i); if (x && x.ok && d) pts.push([x.m, d.v, Q[i]]); } return pts; })() : [];
  // eixo vertical robusto: percentis 2–98 das variações (+ folga); quem passa vira triângulo na borda, com o valor no tooltip
  const dvs = good.map(s => s.dv.v).sort((a, b) => a - b);
  const yLo = Math.floor(Math.min(qt(dvs, 0.02) - 3, (cy || 0) - 3, -2)), yHi = Math.ceil(Math.max(qt(dvs, 0.98) + 3, (cy || 0) + 3, 4));
  const cyv = v => clamp(v, yLo, yHi), out = v => v < yLo || v > yHi;
  const ci = S.qCI ? good.map(s => [s.x.lo, s.x.hi, cyv(s.dv.lo), cyv(s.dv.hi), s.x.m, cyv(s.dv.v)]) : [];
  c.setOption(Object.assign(base(), {
    grid: {left: 64, right: 24, top: 18, bottom: 48},
    xAxis: ax({type: 'log', name: `${PU()} mediano, 12 meses (escala log)`, nameLocation: 'middle', nameGap: 28, axisLabel: {color: css('--muted'), fontSize: 10.5, formatter: v => nf0.format(v)}, min: 'dataMin', max: 'dataMax'}),
    yAxis: ax({type: 'value', min: yLo, max: yHi, name: 'variação 12 m (%)', nameLocation: 'middle', nameGap: 42, axisLabel: {color: css('--muted'), fontSize: 10.5, formatter: v => nf0.format(v) + '%'}}),
    tooltip: Object.assign(base().tooltip, {trigger: 'item', formatter: p => p.data && p.data.cd ? distTip(geoStats(p.data.cd)) : p.seriesName === 'rastro' ? tip(dname(S.qSel), [['Trimestre', p.data[2]], ['R$/m²', nf0.format(p.data[0])], ['Δ 12 m', fSig(p.data[1])]]) : ''}),
    series: [
      {type: 'custom', silent: true, z: 1, data: ci, encode: {x: [0, 1, 4], y: [2, 3, 5]}, renderItem: (params, api) => {
        const a = api.coord([api.value(0), api.value(5)]), b = api.coord([api.value(1), api.value(5)]), cc = api.coord([api.value(4), api.value(2)]), d = api.coord([api.value(4), api.value(3)]);
        const ls = {stroke: css('--axis'), lineWidth: 1};
        return {type: 'group', children: [{type: 'line', shape: {x1: a[0], y1: a[1], x2: b[0], y2: b[1]}, style: ls}, {type: 'line', shape: {x1: cc[0], y1: cc[1], x2: d[0], y2: d[1]}, style: ls}]};
      }},
      {name: 'distritos', type: 'scatter', z: 3, data: good.map(s => ({value: [s.x.m, cyv(s.dv.v)], cd: s.cd, symbolSize: size(s.x.n),
        symbol: out(s.dv.v) ? 'triangle' : 'circle', symbolRotate: s.dv.v < yLo ? 180 : 0,
        itemStyle: {color: zonaCol(DIST[s.cd].r5), opacity: S.qSel && S.qSel !== s.cd ? 0.35 : 0.85, borderColor: css('--surface'), borderWidth: 1},
        label: {show: S.qLab, formatter: DIST[s.cd].nome + (out(s.dv.v) ? ` (${fSig(s.dv.v)})` : ''), position: 'right', fontSize: 10, color: css('--ink-2')}})),
        labelLayout: {hideOverlap: true},
        markLine: cx && cy != null ? {silent: true, symbol: 'none', lineStyle: {color: css('--ink'), type: 'dashed', width: 1}, label: {color: css('--ink-2'), fontSize: 10, formatter: p => p.name},
          data: [{xAxis: cx, name: 'cidade ' + nf0.format(cx)}, {yAxis: cy, name: 'cidade ' + fSig(cy)}]} : undefined},
      {name: `n < ${S.qmin}`, type: 'scatter', z: 2, data: weak.map(s => ({value: [s.x.m, cyv(s.dv.v)], cd: s.cd, symbolSize: 6})), itemStyle: {color: 'transparent', borderColor: css('--muted'), borderWidth: 1}},
      {name: 'rastro', type: 'line', z: 4, data: trail, symbol: 'circle', symbolSize: 5, lineStyle: {color: css('--ink'), width: 1.6}, itemStyle: {color: css('--ink')}, label: {show: true, formatter: p => p.dataIndex === 0 || p.dataIndex === trail.length - 1 ? p.data[2] : '', fontSize: 10, color: css('--ink-2')}},
    ],
  }), true);
  c.off('click'); c.on('click', p => { if (!p.data || !p.data.cd) return; if (S.qSel === p.data.cd) openDist(p.data.cd); else { S.qSel = p.data.cd; renderQuad(); } });
  $('quadLegend').innerHTML = Object.keys(ZONA).map(z => `<span class="it"><i class="dot" style="background:${zonaCol(z)}"></i>${z}</span>`).join('') +
    `<span class="it"><i class="dot" style="box-shadow:inset 0 0 0 1px var(--muted)"></i>n &lt; ${S.qmin} (cinza, sem rótulo)</span><span class="it">▲▼ fora da escala (valor no rótulo)</span><span class="it muted">${esc(sLabel())} · barras = IC95% da mediana e da variação</span>`;
  const qs = {}; good.forEach(s => { const q = quadName(s.x.m, s.dv.v, cx, cy); (qs[q] = qs[q] || []).push(s); });
  $('quadList').innerHTML = ['Caro e acelerando', 'Barato e acelerando', 'Caro e desacelerando', 'Barato e desacelerando'].map(q => `<div class="quad"><h4>${q}</h4><p>${(qs[q] || []).sort((a, b) => b.x.n - a.x.n).slice(0, 8).map(s => esc(s.name)).join(', ') || '—'}</p></div>`).join('');
  $('quadSub').textContent = `${sLabel()} · ${good.length} distritos com n ≥ ${S.qmin}; ${weak.length} abaixo do mínimo (em cinza).`;
  table($('quadTable'), 'quad', [
    {k: 'name', label: 'Distrito', f: r => `<button class="linkbtn" type="button">${esc(r.name)}</button>`},
    {k: 'q', label: 'Quadrante', sv: r => r.x.n >= S.qmin && r.dv ? quadName(r.x.m, r.dv.v, cx, cy) : null, f: r => r.x.n >= S.qmin && r.dv ? quadName(r.x.m, r.dv.v, cx, cy) : '<span class="gray">n baixo</span>'},
    {k: 'm', label: PU() + ' (IQR)', n: 1, sv: r => r.x.m, f: r => priceCell(r.x)},
    {k: 'dv', label: 'Δ 12 m [IC95%]', n: 1, sv: r => r.dv ? r.dv.v : null, f: r => dvCell(r.dv)},
    {k: 'n', label: 'n', n: 1, sv: r => r.x.n, f: r => nf0.format(r.x.n)},
    {k: 'giro', label: 'Giro', n: 1, f: r => r.giro != null ? nf1.format(r.giro) + '%' : '—'},
  ], all.filter(s => s.dv || s.x), {sort: {k: 'n', d: 'desc'}, onRow: r => openDist(r.cd)});
}

/* ════════ DISTRITO ══════════════════════════════════════ */
function renderDistrito() {
  const cd = S.cd, s = geoStats(cd), sp = geoStats('SP');
  $('dTitle').textContent = dname(cd);
  $('dLede').textContent = `${DIST[cd].r8 || ''} · ${sLabel()}. Preço = só negócios com SQL próprio; a planta aparece no volume e na liquidez, separada.`;
  $('dKpis').innerHTML = [
    kpi(PU() + ' (12 m)', s.x && s.x.n ? fPrice(s.x.m) : '—', s.x && s.x.n ? `IQR ${nf0.format(s.x.a)}–${nf0.format(s.x.b)} · n=${nf0.format(s.x.n)}${s.x.ok ? '' : ' (baixo)'}` : ''),
    kpi('Variação 12 m', s.dv ? fSig(s.dv.v) : '—', s.dv ? `IC95% ${fSig(s.dv.lo)} a ${fSig(s.dv.hi)} · cidade ${sp.dv ? fSig(sp.dv.v) : '—'}` : 'n baixo'),
    kpi('Vendas SQL próprio (12 m)', nf0.format(s.own), fMi(s.rv)),
    kpi('Planta (12 m)', nf0.format(s.pl), fMi(s.rvp)),
    kpi(`Giro ${LAST_FULL_Y}`, s.giro != null ? nf1.format(s.giro) + '%' : '—', `cidade ${sp.giro != null ? nf1.format(sp.giro) + '%' : '—'}`),
    kpi('Com financiamento', s.fin != null ? nf0.format(s.fin) + '%' : '—', `cidade ${sp.fin != null ? nf0.format(sp.fin) + '%' : '—'}`),
    kpi(`Fora do preço ${LAST_FULL_Y}`, s.excl != null ? nf0.format(s.excl) + '%' : '—', s.exclPl != null ? `planta ${nf0.format(s.exclPl)}% · ${nf0.format(s.uni)} vendas` : ''),
  ].join('');
  const q0 = winStart();
  volChart('smVol', cd, q0);
  smFin(cd, q0); smNovo(cd, q0); smGiro(cd); exclHeat(cd);
  safe('distritos por tipologia', renderDistTip);
  $('bldSub').textContent = 'Carregando lotes do distrito…';
  renderSections('distrito', {cd, F: DFILE[cd] || null});
  fetchDist(cd).then(() => { if (S.view !== 'distrito' || S.cd !== cd) return; renderTraj('smPrice', cd, true, $('smPriceLeg'), q0); priceNote(cd); renderBldTable(); })
    .catch(() => { $('smPriceNote').textContent = 'Série histórica do distrito indisponível: abra a página pela URL do serve.py (arquivos dist/*.json).'; renderTraj('smPrice', cd, false, $('smPriceLeg'), QR); $('bldSub').textContent = 'Lotes indisponíveis (abra pelo serve.py).'; $('bldTable').innerHTML = ''; });
}
function priceNote(cd) {
  const e = D.exc[cd], yi = YI(LAST_FULL_Y);
  $('smPriceNote').innerHTML = e ? `Em ${LAST_FULL_Y}, ${nf0.format(e.uni[yi])} vendas no universo; <b>${nf0.format(e.pl[yi])}</b> de planta e <b>${nf0.format(e.fl[yi])}</b> sinalizadas ficaram fora do R$/m² (${nf0.format((e.pl[yi] + e.fl[yi]) / Math.max(1, e.uni[yi]) * 100)}%). Ver o mapa de exclusão abaixo.` : '';
}
function smLine(id, q0, ys, fmt, extra = {}) {
  const c = chart(id); if (!c) return; const X = Q.slice(q0);
  c.setOption(Object.assign(base(), {grid: {left: 44, right: 12, top: 8, bottom: 24},
    xAxis: ax({type: 'category', data: X, boundaryGap: false, axisLabel: {color: css('--muted'), fontSize: 10, interval: i => /^1T/.test(X[i]) && (+X[i].slice(-4)) % (X.length > 44 ? 2 : 1) === 0, formatter: v => v.slice(-4)}}),
    yAxis: ax(Object.assign({type: 'value', axisLabel: {color: css('--muted'), fontSize: 10, formatter: fmt}}, extra.y || {})),
    tooltip: Object.assign(base().tooltip, {trigger: 'axis', formatter: extra.tip}), series: ys}), true);
}
function smFin(cd, q0) {
  const v = D.vol[cd], vc = D.vol.SP, rows = i => v.fin[i];
  const gray = []; for (let i = q0; i < NQ; i++) if (v.fin[i] == null && v.nres[i] > 0) gray.push([i - q0, 0]);
  smLine('smFin', q0, [
    {type: 'line', data: v.fin.slice(q0), symbol: 'none', lineStyle: {color: css('--s1'), width: 2}, itemStyle: {color: css('--s1')}},
    ...(S.cityRef ? [{type: 'line', data: vc.fin.slice(q0), symbol: 'none', lineStyle: {color: css('--muted'), width: 1.2, type: 'dashed'}, itemStyle: {color: css('--muted')}}] : []),
    {type: 'scatter', data: gray, symbolSize: 4, itemStyle: {color: css('--gray-cell')}}],
    v => nf0.format(v) + '%', {tip: ps => { const i = q0 + ps[0].dataIndex; return tip(Q[i], [['Distrito', v.fin[i] != null ? nf1.format(v.fin[i]) + '%' : `n baixo (${v.nres[i]})`, css('--s1')], ['n (vendas residenciais)', nf0.format(v.nres[i])], ['Cidade', vc.fin[i] != null ? nf1.format(vc.fin[i]) + '%' : '—', css('--muted')]], 'antes de 2011 o tipo de financiamento não é preenchido; usa-se valor financiado > 0'); }});
}
function smNovo(cd, q0) {
  const v = D.vol[cd], X = Q.slice(q0);
  const tot = i => (v.apn[i] || 0) + (v.pl[i] || 0);
  const sh = (a, i) => tot(i) >= MIN ? a / tot(i) * 100 : null;
  const nov = X.map((_, j) => sh(v.nov[q0 + j], q0 + j)), us = X.map((_, j) => sh(v.apn[q0 + j] - v.nov[q0 + j], q0 + j)), pl = X.map((_, j) => sh(v.pl[q0 + j], q0 + j));
  smLine('smNovo', q0, [
    {name: 'Usado', type: 'line', stack: 'n', data: us, symbol: 'none', areaStyle: {color: css('--s1'), opacity: 0.55}, lineStyle: {width: 0}, itemStyle: {color: css('--s1')}},
    {name: 'Novo (≤3 anos)', type: 'line', stack: 'n', data: nov, symbol: 'none', areaStyle: {color: '#f0bf3f', opacity: 0.8}, lineStyle: {width: 0}, itemStyle: {color: '#f0bf3f'}},
    {name: 'Planta', type: 'line', stack: 'n', data: pl, symbol: 'none', areaStyle: {color: css('--pl'), opacity: 0.75}, lineStyle: {width: 0}, itemStyle: {color: css('--pl')}}],
    v => nf0.format(v) + '%', {y: {max: 100}, tip: ps => { const i = q0 + ps[0].dataIndex; return tip(Q[i], [['Usado', fPct(us[i - q0]), css('--s1')], ['Novo (≤3 anos)', fPct(nov[i - q0]), '#f0bf3f'], ['Planta', fPct(pl[i - q0]), css('--pl')], ['n', nf0.format(tot(i))]], 'antes de 2019 a planta está sub-representada nos arquivos (guias de SQL já cancelado ausentes)'); }});
}
function smGiro(cd) {
  const c = chart('smGiro'); if (!c) return; const e = D.exc[cd], ec = D.exc.SP;
  const y0 = Math.max(ANOS[0], ANOS[ANOS.length - 1] - S.years), ys = ANOS.filter(y => y >= y0);
  const g = (E, y) => { const r = E && E.giro ? E.giro[YI(y)] : null; return r && r[1] ? r[0] / r[1] * 100 : null; };
  c.setOption(Object.assign(base(), {grid: {left: 44, right: 12, top: 8, bottom: 24},
    xAxis: ax({type: 'category', data: ys.map(String), axisLabel: {color: css('--muted'), fontSize: 10}}),
    yAxis: ax({type: 'value', axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf1.format(v) + '%'}}),
    tooltip: Object.assign(base().tooltip, {trigger: 'axis', formatter: ps => { const y = ys[ps[0].dataIndex], r = e && e.giro ? e.giro[YI(y)] : null;
      return tip(String(y) + (y > LAST_FULL_Y ? ' (parcial)' : ''), [['Distrito', g(e, y) != null ? nf1.format(g(e, y)) + '%' : '—', css('--s1')], ['Aptos vendidos / estoque', r ? `${nf0.format(r[0])} / ${nf0.format(r[1] || 0)}` : '—'], ['Cidade', g(ec, y) != null ? nf1.format(g(ec, y)) + '%' : '—', css('--muted')]], `estoque: IPTU ${M.giro_iptu[y]}`); }}),
    series: [{type: 'bar', data: ys.map(y => ({value: g(e, y), itemStyle: {color: y > LAST_FULL_Y ? css('--axis') : css('--s1')}})), barCategoryGap: '30%'},
      ...(S.cityRef ? [{type: 'line', data: ys.map(y => g(ec, y)), symbol: 'circle', symbolSize: 4, lineStyle: {color: css('--muted'), type: 'dashed', width: 1.2}, itemStyle: {color: css('--muted')}}] : [])]}), true);
}
function exclHeat(cdSel) {
  const c = chart('exclHeat'); if (!c) return;
  const ds = DCODES.slice().sort((a, b) => dname(b).localeCompare(dname(a), 'pt'));
  const data = [];
  ds.forEach((cd, yi) => { const e = D.exc[cd]; ANOS.forEach((y, xi) => { const u = e.uni[xi]; data.push([xi, yi, u >= 20 ? (e.pl[xi] + e.fl[xi]) / u * 100 : null, u, e.pl[xi], e.fl[xi]]); }); });
  const iSel = ds.indexOf(cdSel), win = 28;
  // a roda do mouse rola a PÁGINA (não os distritos do gráfico): para navegar, a barra à direita ou arrastar; clicar só no nome abre o distrito
  c.setOption(Object.assign(base(), {
    grid: {left: 150, right: 60, top: 8, bottom: 30},
    xAxis: ax({type: 'category', data: ANOS.map(String), splitLine: {show: false}, axisLabel: {color: css('--muted'), fontSize: 10}}),
    yAxis: ax({type: 'category', data: ds.map(dname), splitLine: {show: false}, triggerEvent: true, axisLabel: {fontSize: 10, color: css('--ink-2'), formatter: (v, i) => ds[i] === cdSel ? `{b|${v}}` : v, rich: {b: {fontWeight: 700, color: css('--ink'), fontSize: 11}}}}),
    visualMap: {type: 'continuous', min: 0, max: 60, dimension: 2, orient: 'vertical', right: 0, top: 'middle', itemHeight: 160, itemWidth: 10, calculable: false,
      inRange: {color: HEAT}, text: ['60%+', '0%'], textStyle: {color: css('--muted'), fontSize: 10}, outOfRange: {color: css('--gray-cell')}},
    dataZoom: [{type: 'inside', yAxisIndex: 0, startValue: Math.max(0, iSel - win / 2), endValue: Math.min(ds.length - 1, iSel + win / 2), zoomOnMouseWheel: false, moveOnMouseWheel: false, moveOnMouseMove: true, preventDefaultMouseMove: false},
      {type: 'slider', yAxisIndex: 0, right: 40, width: 10, showDetail: false, startValue: Math.max(0, iSel - win / 2), endValue: Math.min(ds.length - 1, iSel + win / 2)}],
    tooltip: Object.assign(base().tooltip, {trigger: 'item', formatter: p => { const [xi, yi, v, u, pl, fl] = p.data;
      return tip(`${dname(ds[yi])} · ${ANOS[xi]}${ANOS[xi] > LAST_FULL_Y ? ' (parcial)' : ''}`, [['Fora do preço', v != null ? nf0.format(v) + '%' : `n baixo (${u})`], ['Universo (vendas)', nf0.format(u)], ['Planta', `${nf0.format(pl)} (${u ? nf0.format(pl / u * 100) : 0}%)`], ['Sinalizadas', `${nf0.format(fl)} (${u ? nf0.format(fl / u * 100) : 0}%)`]], 'antes de 2019 a planta está sub-representada (extração antiga da Prefeitura)'); }}),
    series: [{type: 'heatmap', data: data.map(d => d[2] == null ? {value: d, itemStyle: {color: css('--gray-cell')}} : d), itemStyle: {borderColor: css('--surface'), borderWidth: 1}, emphasis: {itemStyle: {borderColor: css('--ink'), borderWidth: 1.5}}}],
  }), true);
  c.off('click'); c.on('click', p => { if (p.componentType !== 'yAxis') return; const cd = ds[ds.map(dname).indexOf(p.value)]; if (cd && cd !== S.cd) openDist(cd); });
}
/* todos os distritos × faixas do estrato (tipo e dimensão do topo): mediana 12 m, variação ou nº de vendas */
function renderDistTip() {
  const faixas = FXD(S.dim), cols = fxColors(S.dim), met = S.dtMet || 'm';
  document.querySelectorAll('#dtMet button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === met)));
  const keys = [['*', skey(S.tipo, S.dim, '*')]].concat(faixas.map(f => [f, skey(S.tipo, S.dim, f)]));
  const cell = (cd, k) => { const s = ser(cd, k, false); return {x: st(s, LQ), dv: delta(s, LQ)}; };
  const q = normTxt($('dtSearch').value);
  const rows = ['SP'].concat(DCODES).filter(cd => !q || cd === 'SP' || normTxt(dname(cd)).includes(q))
    .map(cd => ({cd, name: dname(cd), c: Object.fromEntries(keys.map(([f, k]) => [f, cell(cd, k)]))}));
  const val = (c) => met === 'm' ? (c.x && c.x.ok ? c.x.m : null) : met === 'dv' ? (c.dv ? c.dv.v : null) : (c.x ? c.x.n : null);
  const show = c => {
    const x = c.x;
    if (met === 'n') return x && x.n ? nf0.format(x.n) : '<span class="gray">0</span>';
    if (met === 'dv') return c.dv ? `<span class="${c.dv.sig ? 'sig' : 'gray'}" title="IC95% ${fSig(c.dv.lo)} a ${fSig(c.dv.hi)}${c.dv.sig ? '' : ' (inclui zero: não significativo)'} · n=${nf0.format(c.dv.n1)}">${fSig(c.dv.v)}</span>` : '<span class="gray" title="n abaixo do mínimo em um dos períodos">—</span>';
    if (!x || !x.n) return '<span class="gray">—</span>';
    return x.ok ? `${nf0.format(x.m)}<small class="dtn">${nf0.format(x.n)}</small>` : `<span class="gray" title="n abaixo do mínimo (${MIN}): valor frágil">${nf0.format(x.m)}<small class="dtn">${nf0.format(x.n)}</small></span>`;
  };
  const colDefs = [{k: 'name', label: 'Distrito', sv: r => r.cd === 'SP' ? '' : r.name, f: r => r.cd === 'SP' ? `<b>${esc(r.name)}</b>` : `<button class="linkbtn" type="button">${esc(r.name)}</button>`}]
    .concat(keys.map(([f], i) => ({k: 'f' + i, n: 1, label: f === '*' ? 'Todas' : `<i class="dtdot" style="background:${cols[i - 1]}"></i>${esc(S.dim === 'area' ? f + ' m²' : S.dim === 'padrao' ? 'Padrão ' + f : S.dim === 'quartos' ? f + (f === '1' ? ' dorm.' : ' dorms.') : f + ' anos')}`,
      title: f === '*' ? 'todas as faixas do tipo' : fxLab(S.dim, f), sv: r => val(r.c[f]), f: r => show(r.c[f])})));
  const metLb = {m: `${BASE_LB[baseOf()] || PU()}, mediana de 12 meses (o número pequeno é o n de vendas)`, dv: 'variação da mediana contra os 12 meses anteriores (negrito = IC95% exclui zero)', n: 'vendas do estrato em 12 meses'}[met];
  $('dtSub').textContent = `${GRP_LB[S.tipo] || TIPO_LB[S.tipo]} por ${DIMLB[S.dim]} · ${metLb} · até ${M.last_q}. Mude o tipo e a dimensão no seletor de estrato do topo.`;
  // fixas no topo em qualquer ordenação: o distrito da página e, logo abaixo, a cidade (referência)
  table($('dtTable'), 'dtip', colDefs, rows, {sort: {k: 'f0', d: 'desc'}, page: 25, pageKey: S.tipo + S.dim + met + q, pin: r => r.cd === S.cd ? 1 : r.cd === 'SP' ? 2 : 0,
    sel: r => r.cd === S.cd, rowAttr: r => r.cd === 'SP' ? 'class="city"' : '', rowLink: true, onRow: r => { if (r.cd !== 'SP' && r.cd !== S.cd) openDist(r.cd); }});
  $('dtNote').innerHTML = `Cinza = n abaixo de ${MIN} vendas (valor frágil, visível para contexto). Só negócios com SQL próprio entram no preço; planta fica de fora.${S.dim === 'padrao' ? ' Padrão = padrão construtivo do IPTU (Prefeitura), A mais simples … F mais alto.' : ''}`;
}
function lotRows(F) {
  const q = normTxt($('bldSearch').value);
  return F.lots.filter(l => (!S.bldOnlyStr || grpOf(l.t) === S.tipo || (l.pl > 0 && S.tipo === 'apto')) && (!q || normTxt((l.nm || '') + ' ' + (l.end || '')).includes(q)));
}
const normTxt = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function renderBldTable() {
  const F = DFILE[S.cd]; if (!F) return;
  const rows = lotRows(F), total = rows.length;
  $('bldSub').textContent = `${nf0.format(total)} lotes com venda${S.bldOnlyStr ? ' (' + (GRP_LB[S.tipo] || TIPO_LB[S.tipo]).toLowerCase() + ')' : ''}. Clique no nome para abrir o prédio; clique no cabeçalho para ordenar.`;
  table($('bldTable'), 'bld', [
    {k: 'nm', label: 'Prédio / endereço', cls: 'wrap', sv: r => r.nm || r.end, f: r => `<button class="linkbtn" type="button">${esc(r.nm || r.end || r.id)}</button>${r.nm && r.end ? `<div class="qtag" style="margin:0">${esc(r.end)}</div>` : ''}`},
    {k: 't', label: 'Tipo', f: r => `<span class="pill${r.pl ? ' pl' : ''}">${esc(TIPO_LB[r.t] || r.t)}${r.pl ? ' · planta ' + r.pl : ''}</span>`},
    {k: 'u', label: 'Unid. IPTU', n: 1, sv: r => r.u ? r.u[0] : null, f: r => r.u ? nf0.format(r.u[0]) : '—'},
    {k: 'acc', label: 'ACC', n: 1, title: 'ano de conclusão da construção (IPTU)', sv: r => r.u ? r.u[4] : null, f: r => r.u && r.u[4] ? r.u[4] : '—'},
    {k: 'pad', label: 'Padrão ⓘ', title: 'Padrão construtivo do cadastro do IPTU (Prefeitura de SP), que vem em cada guia de ITBI: A = mais simples … F = mais alto (tabela de valores de construção da Lei 10.235/1986). Cadastro vigente quando o arquivo foi gerado.', sv: r => r.u ? r.u[5] : null, f: r => r.u && r.u[5] ? `<span title="${esc(r.u[5])}">${esc((r.u[5].match(/padr[ãa]o ([A-F])/i) || [])[1] || '—')}</span>` : '—'},
    {k: 'n5', label: 'Vendas 5a', n: 1},
    {k: 'g1', label: 'Giro 12 m', n: 1, title: 'aptos vendidos em 12 meses ÷ aptos do prédio (IPTU)', sv: r => r.g1 && r.g1[1] ? r.g1[0] / r.g1[1] : null, f: r => r.g1 && r.g1[1] ? nf1.format(r.g1[0] / r.g1[1] * 100) + '%' : '—'},
    {k: 'p', label: PU() + ' 5a (IQR)', n: 1, sv: r => r.p ? r.p[2] : null, f: r => r.p ? priceCell({n: r.p[0], a: r.p[1], m: r.p[2], b: r.p[3], ok: r.p[0] >= 3}) : '<span class="gray">—</span>'},
    {k: 'd2', label: 'Última venda', n: 1, f: r => fDate(r.d2)},
    {k: 'qa', label: 'Anúncios', n: 1, sv: r => r.qa ? r.qa.n : null, f: r => r.qa ? `${r.qa.ns}v · ${r.qa.nr}a` : '—'},
  ], rows, {sort: {k: 'n5', d: 'desc'}, page: 25, pageKey: S.cd + '|' + S.tipo + '|' + S.bldOnlyStr + '|' + normTxt($('bldSearch').value), rowLink: true, onRow: r => openLot(S.cd, r.id)});
}

/* ════════ PRÉDIO ════════════════════════════════════════ */
let MP = null; const MPS = {};
function curLot() { const F = DFILE[S.lotCd]; if (!F) return null; return F.lots.find(l => l.id === S.lot) || null; }
function lotDeals(F, li) { const d = F.deals, out = []; for (let k = 0; k < d.li.length; k++) if (d.li[k] === li) out.push(k); return out; }
/* preço de UM negócio na base do tipo dele (I-036): R$/m² construído, R$/m² de terreno (coluna `at`) ou R$ por vaga */
const rsOf = (d, k) => {
  const b = BASE[grpOf(TIPO_OF[d.t[k]])] || 'm2c'; if (d.v100[k] == null) return null;
  if (b === 'unid') return d.v100[k];
  if (b === 'm2t') return d.at && d.at[k] ? d.v100[k] / d.at[k] : null;
  return d.a[k] ? d.v100[k] / d.a[k] : null;
};
const areaOf = (d, k) => (BASE[grpOf(TIPO_OF[d.t[k]])] === 'm2t' ? (d.at ? d.at[k] : null) : d.a[k]);
const fxOf = (d, k, dim) => { const c = {area: d.fa, padrao: d.fp, idade: d.fi, quartos: d.fq}[dim][k]; return c == null ? null : FXD(dim, grpOf(TIPO_OF[d.t[k]]) || 'apto')[c]; };
function renderPredio() {
  if (!S.lot || !S.lotCd) { // padrão: o lote com mais vendas do distrito corrente
    fetchDist(S.cd).then(F => { const l = F.lots.slice().sort((a, b) => b.n5 - a.n5)[0]; if (l) { S.lot = l.id; S.lotCd = S.cd; renderPredio(); } }).catch(() => {});
    $('pHead').innerHTML = '<div class="loading">Escolha um prédio no mapa ou na tabela do distrito.</div>'; return;
  }
  const F = DFILE[S.lotCd];
  if (!F) { $('pHead').innerHTML = '<div class="loading">Carregando…</div>'; fetchDist(S.lotCd).then(() => { if (S.view === 'predio') renderPredio(); }).catch(() => { $('pHead').innerHTML = '<div class="empty">Dados do lote indisponíveis: abra a página pela URL do serve.py.</div>'; }); return; }
  const l = curLot(); if (!l) { $('pHead').innerHTML = '<div class="empty">Lote não encontrado.</div>'; return; }
  const d = F.deals, ks = lotDeals(F, l.i), u = l.u;
  const lotTipo = grpOf(l.t) || S.tipo;   // grupo do tipo predominante do lote (I-036)
  $('pHead').innerHTML = `<h3>${esc(l.nm || l.end || 'Lote ' + l.id)}</h3><span class="meta">${esc(l.nm && l.end ? l.end + ' · ' : '')}${esc(dname(S.lotCd))} · lote fiscal ${l.id.slice(0, 3)}.${l.id.slice(3, 6)}.${l.id.slice(6, 10)}${l.id.slice(10) !== '00' ? ' · condomínio ' + l.id.slice(10) : ''}</span>` +
    `<span class="pill">${esc(TIPO_LB[l.t] || l.t)}</span>${l.pl ? `<span class="pill pl">planta: ${l.pl} unid.</span>` : ''}` +
    (u ? `<span class="meta">IPTU ${esc(M.iptu_perfil || '')}: ${nf0.format(u[0])} unidades${u[1] ? ` (${nf0.format(u[1])} aptos, ${nf0.format(u[2])} vagas)` : ''}${u[3] ? ` · ${u[3]} pav.` : ''}${u[4] ? ` · ACC ${u[4]}` : ''}${u[5] ? ` · ${esc(u[5])}` : ''}</span>` : '') +
    `<button class="linkbtn" type="button" id="pBack" style="margin-left:auto">← ${esc(dname(S.lotCd))}</button>`;
  $('pBack').insertAdjacentHTML('beforebegin', badgesHtml('predio', {cd: S.lotCd, lot: l, F}));
  $('pBack').onclick = () => openDist(S.lotCd);
  const ok = ks.filter(k => d.ok[k]), rs5 = ok.filter(k => d.d[k] >= l.d2 - 5 * 365).map(k => rsOf(d, k)).filter(Boolean);
  $('pKpis').innerHTML = [
    kpi('Negócios', nf0.format(l.n), `${nf0.format(l.n5)} em 5 anos · ${nf0.format(ok.length)} no preço`),
    kpi(PU(lotTipo) + ' 5 anos', l.p ? fPrice(l.p[2], lotTipo) : '—', l.p ? `IQR ${nf0.format(l.p[1])}–${nf0.format(l.p[3])} · n=${l.p[0]}` : 'sem venda elegível'),
    kpi('Giro 12 m', l.g1 && l.g1[1] ? nf1.format(l.g1[0] / l.g1[1] * 100) + '%' : '—', l.g1 ? `${l.g1[0]} de ${l.g1[1] || '—'} aptos` : 'não é condomínio de aptos'),
    kpi('Última venda', fDate(l.d2), ''),
    kpi('Anúncios no lote', l.qa ? nf0.format(l.qa.n) : '0', l.qa ? `${l.qa.ns} venda · ${l.qa.nr} aluguel (jun/2026)` : 'QuintoAndar'),
  ].join('');
  const tipSub = $('pTipSub'); if (tipSub) tipSub.textContent = `Unidades do cadastro (IPTU ${M.iptu_perfil || ''}) e anúncios QuintoAndar dentro do lote (foto de 20/06/2026).`;
  safe('histórico', () => renderPHist(F, l, ks, lotTipo));
  safe('tipologias', () => renderTip(l, F, ks));
  safe('negócios', () => renderDealsTable(F, ks));
  safe('comparáveis', () => renderComps());
  renderSections('predio', {cd: S.lotCd, lot: l, F, ks});
}
/* um painel com defeito não derruba os outros; o erro vai para <html data-err> */
function safe(name, fn) { try { fn(); } catch (e) { logErr(name + ': ' + (e && e.stack || e)); console.error(name, e); } }
/* histórico de vendas do lote: na página do Prédio (id pHist) e, em versão compacta (mini), no cartão do lote sobre o mapa da Cidade.
   Só negócios do GRUPO do lote entram no eixo (bases de preço diferentes não se misturam: I-036). */
function renderPHist(F, l, ks, lotTipo, id = 'pHist', mini = false) {
  const c = chart(id); if (!c) return; const d = F.deals;
  const dim = (DIMS_T[lotTipo] || ['area']).includes(S.dim) ? S.dim : (DIMS_T[lotTipo] || ['area'])[0];
  const fxs = FXD(dim, lotTipo), cols = fxColors(dim, lotTipo), day0 = Date.UTC(2006, 0, 1);
  const pts = ks.map(k => { const r = rsOf(d, k); if (r == null || d.t[k] === TC.planta || grpOf(TIPO_OF[d.t[k]]) !== lotTipo) return null; const fx = fxOf(d, k, dim);
    return {value: [day0 + d.d[k] * 864e5, Math.round(r)], k, itemStyle: d.ok[k] ? {color: fx ? cols[fxs.indexOf(fx)] : css('--ink'), borderColor: css('--surface')} : {color: 'transparent', borderColor: css('--muted')}}; }).filter(Boolean);
  const fxSel = dim === S.dim && fxs.includes(S.fx) ? S.fx : '*';
  const s = ser(l.cd || S.lotCd, skey(lotTipo, dim, fxSel), true);
  const band = [], line = [];
  if (s) for (let i = QF; i < NQ; i++) { const x = st(s, i); if (x && x.ok) { const t = Date.UTC(Q0Y(i), ((i % 4) * 3) + 2, 15); line.push([t, x.m]); band.push([t, x.a, x.b]); } }
  c.setOption(Object.assign(base(), {grid: mini ? {left: 48, right: 10, top: 8, bottom: 24} : {left: 56, right: 14, top: 12, bottom: 30},
    xAxis: ax({type: 'time', minInterval: 365.25 * 864e5, axisLabel: {color: css('--muted'), fontSize: 10, formatter: '{yyyy}', hideOverlap: true}}),
    yAxis: ax({type: 'value', scale: true, axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf0.format(v)}}),
    tooltip: Object.assign(base().tooltip, {trigger: 'item', formatter: p => { if (p.seriesName !== 'vendas') return p.seriesName === 'distrito' ? tip('Distrito · mesmo estrato', [['Mediana 12 m', nf0.format(p.data[1])]]) : '';
      const k = p.data.k; return tip(`${fDate(d.d[k])} · ${d.cp[k] || 'unidade'}`, [[PU(lotTipo), fPrice(p.data.value[1], lotTipo)], ['Valor (100%)', fR(d.v100[k])], [BASE[lotTipo] === 'm2t' ? 'Área do terreno' : 'Área construída', areaOf(d, k) ? nf0.format(areaOf(d, k)) + ' m²' : '—'],
        ['Faixa', [fxOf(d, k, 'area'), fxOf(d, k, 'padrao') ? 'padrão ' + fxOf(d, k, 'padrao') : null, fxOf(d, k, 'idade') ? fxOf(d, k, 'idade') + ' anos' : null, fxOf(d, k, 'quartos') ? fxOf(d, k, 'quartos') + ' dorm. (est.)' : null].filter(Boolean).join(' · ')],
        ['Status', d.ok[k] ? 'entra no preço' : 'fora: ' + MOT[d.mo[k]]]]); }}),
    series: [
      {name: 'iqr', type: 'custom', silent: true, z: 1, data: band, renderItem: (pr, api) => { if (pr.dataIndex === 0) return; const a = band[pr.dataIndex - 1], b = band[pr.dataIndex];
        const p1 = api.coord([a[0], a[1]]), p2 = api.coord([b[0], b[1]]), p3 = api.coord([b[0], b[2]]), p4 = api.coord([a[0], a[2]]);
        return {type: 'polygon', shape: {points: [p1, p2, p3, p4]}, style: {fill: css('--s1'), opacity: 0.12}}; }},
      {name: 'distrito', type: 'line', data: line, symbol: 'none', lineStyle: {color: css('--muted'), width: 1.4, type: 'dashed'}, z: 2},
      {name: 'vendas', type: 'scatter', data: pts, symbolSize: mini ? 6 : 7, z: 3},
    ]}), true);
  if (mini) return;
  $('pHistSub').textContent = `Cada ponto é um negócio (${BASE_LB[baseOf(lotTipo)] || PU(lotTipo)}). Cor = ${DIMLB[dim]}; vazado = fora do preço. Tracejado e faixa = mediana e IQR do distrito, ${(GRP_LB1[lotTipo] || TIPO_LB[lotTipo] || '').toLowerCase()} · ${fxSel === '*' ? 'todas as faixas' : fxLab(dim, fxSel, lotTipo)}.`;
  $('pHistLeg').innerHTML = fxs.map((f, i) => `<span class="it"><i class="dot" style="background:${cols[i]}"></i>${esc(fxLab(dim, f, lotTipo))}</span>`).join('') + `<span class="it"><i class="dot" style="box-shadow:inset 0 0 0 1px var(--muted)"></i>fora do preço</span>`;
}
const Q0Y = i => 2006 + Math.floor(i / 4);
function renderTip(l, F, ks) {
  const parts = [];
  const tp = l.tp, qa = l.qa;
  if (tp && tp.length) {
    const mx = Math.max(...tp.map(t => t[1]));
    parts.push(`<div class="tipsec"><h4>Unidades no cadastro (m² construída)</h4>` + tp.map(([a, n]) => `<div class="tipbar"><span>${nf0.format(a)} m²</span><div class="b" style="width:${Math.max(3, n / mx * 160)}px"></div><b>${nf0.format(n)}</b></div>`).join('') + '</div>');
  }
  if (qa && qa.q.length) {
    const mx = Math.max(...qa.q.map(q => q[1]));
    // razão só em prédio de tipologia quase única (≥80% dos aptos na área mais frequente); senão compara tipologias diferentes
    const homog = tp && tp.length && l.u && l.u[1] && tp[0][1] / l.u[1] >= 0.8;
    const ratio = homog && qa.am ? tp[0][0] / qa.am : null;
    parts.push(`<div class="tipsec"><h4>Anúncios QuintoAndar por quartos</h4>` + qa.q.map(([q, n, a, p, r]) => `<div class="tipbar"><span>${q === 0 ? 'studio' : q + ' dorm.'}</span><div class="b qa" style="width:${Math.max(3, n / mx * 120)}px"></div><b>${n}</b><span class="muted" style="min-width:0">${a ? a + ' m² priv.' : ''}${p ? ' · pede ' + fR(p) : ''}${r ? ' · aluga ' + fR(r) : ''}</span></div>`).join('') +
      (ratio && ratio > 0.9 && ratio < 3 ? `<p class="note">Razão construída ÷ privativa neste prédio ≈ <b>${nf2.format(ratio)}</b> (cidade: 1,64).</p>` : '') + '</div>');
    const d = F.deals, recent = ks.filter(k => d.ok[k] && d.t[k] === TC.apto && d.d[k] >= l.d2 - 2 * 365).map(k => d.v100[k]);
    const ask = qa.q.map(q => q[3]).filter(Boolean);
    if (recent.length >= 3 && qa.ns >= 3 && tp && tp.length && tp[0][1] / l.u[1] >= 0.8) {
      const mc = med(recent), ma = med(qa.q.filter(q => q[3]).map(q => q[3]));
      parts.push(`<p class="note">Prédio de tipologia quase única: pedido mediano ${fR(ma)} × fechado mediano ${fR(mc)} (24 meses) → spread <b>${fSig((ma / mc - 1) * 100)}</b>. Anúncios de jun/2026; parte do spread é defasagem de tempo.</p>`);
    }
  }
  if (!parts.length) parts.push('<p class="sub">Sem unidades de apartamento no cadastro nem anúncios dentro do lote.</p>');
  $('pTip').innerHTML = parts.join('');
}
function renderDealsTable(F, ks) {
  const d = F.deals;
  const rows = ks.map(k => ({k, d: d.d[k], cp: d.cp[k], t: TIPO_OF[d.t[k]], a: areaOf(d, k), v: d.v[k], v100: d.v100[k], rs: rsOf(d, k), ok: d.ok[k], mo: d.mo[k], fin: d.fin[k], fq: fxOf(d, k, 'quartos'), fa: fxOf(d, k, 'area'), ac: d.ac[k]}));
  table($('pDeals'), 'deals', [
    {k: 'd', label: 'Data', f: r => fDate(r.d)}, {k: 'cp', label: 'Unidade', f: r => esc(r.cp || '—')},
    {k: 't', label: 'Tipo', f: r => `<span class="pill${r.t === 'planta' ? ' pl' : ''}">${esc(TIPO_LB[r.t])}</span>`},
    {k: 'a', label: 'Área (m²)', n: 1, title: 'área construída do IPTU; para terreno, área do terreno', f: r => r.a ? nf0.format(r.a) + (r.t === 'terreno' ? ' terr.' : '') : '—'}, {k: 'v', label: 'Valor declarado', n: 1, f: r => fR(r.v)},
    {k: 'rs', label: 'Preço', n: 1, title: 'na base do tipo do negócio: R$/m² construído, R$/m² de terreno ou R$ por vaga', f: r => r.rs && r.t !== 'planta' ? fPrice(r.rs, grpOf(r.t)) : '—'}, {k: 'fa', label: 'Faixa', f: r => esc(r.fa || '—')},
    {k: 'fq', label: 'Quartos (est.)', f: r => esc(r.fq || '—')}, {k: 'ac', label: 'ACC', n: 1, f: r => r.ac || '—'}, {k: 'fin', label: 'Financ.', f: r => r.fin ? 'sim' : ''},
    {k: 'ok', label: 'Status', f: r => r.ok ? '<span class="pill ok">no preço</span>' : `<span class="gray">${esc(MOT[r.mo] || 'fora')}</span>`},
  ], rows, {sort: {k: 'd', d: 'desc'}, page: 15, pageKey: S.lotCd + S.lot, rowAttr: r => r.ok ? '' : 'style="color:var(--muted)"'});
}
function renderComps() {
  const l = curLot(), F = DFILE[S.lotCd]; if (!l || !F) return;
  $('radiusVal').textContent = nf1.format(S.radius) + ' km';
  const lotTipo = grpOf(l.t) || S.tipo; MPS.lt = lotTipo;
  const dim = (DIMS_T[lotTipo] || ['area']).includes(S.dim) ? S.dim : (DIMS_T[lotTipo] || ['area'])[0];
  let fx = dim === S.dim && FXD(dim, lotTipo).includes(S.fx) ? S.fx : '*';
  if (fx === '*') { const d = F.deals, cnt = {}; lotDeals(F, l.i).forEach(k => { const f = d.ok[k] && grpOf(TIPO_OF[d.t[k]]) === lotTipo ? fxOf(d, k, dim) : null; if (f) cnt[f] = (cnt[f] || 0) + 1; }); const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; fx = top ? top[0] : '*'; }
  const r = S.radius, c0 = l.c, dLat = r / 111, dLng = r / (111 * Math.cos(c0[1] * Math.PI / 180));
  const need = DCODES.filter(cd => { const b = DIST[cd].bb; return !(b[2] < c0[0] - dLng || b[0] > c0[0] + dLng || b[3] < c0[1] - dLat || b[1] > c0[1] + dLat); });
  $('compSub').textContent = 'Carregando distritos vizinhos…';
  Promise.allSettled(need.map(fetchDist)).then(() => {
    if (S.view !== 'predio' || curLot() !== l) return;
    const dmin = Math.max(...Object.values(DFILE).map(f => Math.max(...f.deals.d.slice(-50)))) - S.compYears * 365;
    const byLot = new Map();
    need.forEach(cd => { const G = DFILE[cd]; if (!G) return; const d = G.deals;
      for (let k = 0; k < d.d.length; k++) {
        if (!d.ok[k] || grpOf(TIPO_OF[d.t[k]]) !== lotTipo || d.d[k] < dmin) continue;   // mesmo GRUPO (loja + sala + escr contam juntos)
        if (fx !== '*' && fxOf(d, k, dim) !== fx) continue;
        const pr = rsOf(d, k); if (pr == null) continue;
        const L = G.lots[d.li[k]], dist = haversine(c0, L.c); if (dist > r) continue;
        const key = cd + ':' + L.i; let e = byLot.get(key); if (!e) byLot.set(key, e = {cd, L, dist, rs: [], ds: [], self: L.id === l.id && cd === S.lotCd});
        e.rs.push(pr); e.ds.push(d.d[k]);
      } });
    const comps = [...byLot.values()].map(e => ({...e, n: e.rs.length, m: med(e.rs), last: Math.max(...e.ds)}));
    const allRs = comps.filter(e => !e.self).flatMap(e => e.rs), self = comps.find(e => e.self);
    const mAll = med(allRs), a = qt(allRs, .25), b = qt(allRs, .75);
    $('compSub').textContent = `${GRP_LB1[lotTipo] || TIPO_LB[lotTipo]} · ${DIMLB[dim]} ${fx === '*' ? 'todas as faixas' : fxLab(dim, fx, lotTipo)}${S.fx === '*' && fx !== '*' ? ' (faixa mais comum no prédio; escolha outra no topo)' : ''} · raio ${nf1.format(r)} km · ${S.compYears * 12} meses · só negócios no preço.`;
    $('compSummary').innerHTML = allRs.length ? `<b>${nf0.format(allRs.length)}</b> vendas comparáveis em ${comps.length - (self ? 1 : 0)} lotes · mediana <b>${fPrice(Math.round(mAll), lotTipo)}</b> (IQR ${nf0.format(a)}–${nf0.format(b)})` +
      (self ? ` · este prédio: <b>${fPrice(Math.round(self.m), lotTipo)}</b> (n=${self.n}) → <b>${fSig((self.m / mAll - 1) * 100)}</b> contra o entorno` : ' · este prédio não teve venda do mesmo estrato na janela') +
      (allRs.length < MIN ? ` <span class="gray">(n abaixo de ${MIN}: amplie raio ou janela)</span>` : '') : `Sem comparáveis do estrato no raio. Amplie o raio, a janela ou mude a faixa.`;
    table($('compTable'), 'comp', [
      {k: 'nm', label: 'Prédio / endereço', cls: 'wrap', sv: e => e.L.nm || e.L.end, f: e => `<button class="linkbtn" type="button">${esc(e.L.nm || e.L.end || e.L.id)}</button>${e.self ? ' <span class="pill ok">este</span>' : ''}`},
      {k: 'dist', label: 'Distância', n: 1, f: e => nf0.format(e.dist * 1000) + ' m'}, {k: 'n', label: 'Vendas', n: 1},
      {k: 'm', label: PU(lotTipo) + ' mediano', n: 1, f: e => nf0.format(e.m)}, {k: 'dvs', label: 'vs entorno', n: 1, sv: e => e.m / mAll, f: e => fSig((e.m / mAll - 1) * 100)},
      {k: 'last', label: 'Última', n: 1, f: e => fDate(e.last)}, {k: 'acc', label: 'ACC', n: 1, sv: e => e.L.u ? e.L.u[4] : null, f: e => e.L.u && e.L.u[4] ? e.L.u[4] : '—'},
    ], comps, {sort: {k: 'dist', d: 'asc'}, page: 12, pageKey: l.id + S.radius + S.compYears + fx, pin: e => e.self, sel: e => e.self, rowLink: true, onRow: e => { if (!e.self) openLot(e.cd, e.L.id); }});
    compMap(l, comps, mAll);
  });
}
function compMap(l, comps, mAll) {
  if (!MP) { MP = createBaseMap($('pMap'), {layers: {predios: 'off', lotes: 'off'}, pitch: 40, onStyle: () => compMap(MPS.l, MPS.comps, MPS.mAll)}); if (MP) wireCompMap(); }
  MPS.l = l; MPS.comps = comps; MPS.mAll = mAll;
  const H = MP; if (!H || !H.ready) return;
  const map = H.map, lo = mAll ? mAll * 0.6 : 1500, hi = mAll ? mAll * 1.6 : 16000;
  const feats = comps.filter(e => !e.self).map(e => ({type: 'Feature', geometry: lotFeature(e.L), properties: {cd: e.cd, i: e.L.i, fc: priceColor(e.m, lo, hi), h: 6 + Math.min(40, e.n * 3)}}));
  upsertSrc(map, 'app-comp', {type: 'FeatureCollection', features: feats});
  addLayerOnce(map, {id: 'app-comp-3d', type: 'fill-extrusion', source: 'app-comp', paint: {'fill-extrusion-color': ['get', 'fc'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.9}});
  upsertSrc(map, 'app-self', {type: 'Feature', geometry: lotFeature(l), properties: {}});
  addLayerOnce(map, {id: 'app-self-3d', type: 'fill-extrusion', source: 'app-self', paint: {'fill-extrusion-height': 60, 'fill-extrusion-opacity': 0.95}});
  map.setPaintProperty('app-self-3d', 'fill-extrusion-color', css('--ink'));
  const circ = []; for (let a = 0; a <= 64; a++) { const t = a / 64 * 2 * Math.PI; circ.push([l.c[0] + S.radius / (111 * Math.cos(l.c[1] * Math.PI / 180)) * Math.cos(t), l.c[1] + S.radius / 111 * Math.sin(t)]); }
  upsertSrc(map, 'app-rad', {type: 'Feature', geometry: {type: 'LineString', coordinates: circ}, properties: {}});
  addLayerOnce(map, {id: 'app-rad', type: 'line', source: 'app-rad', paint: {'line-width': 1.4, 'line-dasharray': [3, 2]}});
  map.setPaintProperty('app-rad', 'line-color', css('--ink-2'));
  if (MPS.fitFor !== l.id + ':' + S.radius) { MPS.fitFor = l.id + ':' + S.radius; const dx = S.radius / (111 * Math.cos(l.c[1] * Math.PI / 180)), dy = S.radius / 111; H.fit({bounds: [[l.c[0] - dx, l.c[1] - dy], [l.c[0] + dx, l.c[1] + dy]], padding: 16, maxZoom: 17, pitch: 40}); }
  decorate(H, {center: l.c, radius: S.radius, view: 'predio'});
  $('pMapLeg').innerHTML = `<span class="it"><i class="dot" style="border-radius:2px;background:var(--ink)"></i>este prédio</span><span class="scale">comparáveis: ${esc(PU(MPS.lt || S.tipo))} ${nf0.format(lo)}<span class="g" style="background:${gradCss(RAMP[mode()].seq)}"></span>${nf0.format(hi)}</span><span class="it muted">altura = nº de vendas · tracejado = raio</span>` +
    (REG.decor.length ? '<span class="it muted">ícones = equipamentos e estações no entorno (aproxime para ver todos)</span>' : '');
}
function wireCompMap() {
  wireMap(MP, {layers: () => ['app-comp-3d'].concat(decorHits(MP)),
    tip: f => { const t = decorTip(f); if (t !== undefined) return t; const e = (MPS.comps || []).find(e => e.cd === f.properties.cd && e.L.i === f.properties.i); return e ? tip(e.L.nm || e.L.end || e.L.id, [[PU(MPS.lt || S.tipo) + ' mediano', fPrice(e.m, MPS.lt || S.tipo)], ['Vendas no estrato', nf0.format(e.n)], ['Distância', nf0.format(e.dist * 1000) + ' m'], ['vs entorno', fSig((e.m / MPS.mAll - 1) * 100)]], 'clique para abrir') : null; },
    click: f => { if (decorTip(f) !== undefined) return; const F = DFILE[f.properties.cd]; if (F) openLot(f.properties.cd, F.lots[f.properties.i].id); }});
}
/* camadas de decoração que respondem a hover (ícones de equipamentos): o módulo que desenha registra hits/tip em H.decor */
const decorHits = H => (H && H.decor ? Object.values(H.decor).flatMap(d => d.hits ? d.hits() : []) : []);
function decorTip(f) {
  const id = f && f.layer && f.layer.id; if (!id) return undefined;
  for (const H of BMAPS) for (const d of Object.values(H.decor || {})) if (d.hits && d.hits().includes(id)) return d.tip ? d.tip(f) : null;
  return undefined;
}

/* ── cartão do lote sobre o mapa da Cidade (30/09) ───────────────────────────────
   Clique num lote: em vez de trocar de página, um cartão flutuante dentro do mapa (como o perfil do entorno no Lançamento)
   mostra o gráfico das vendas do lote no tempo, a tabela dos negócios e o botão "Detalhes do lote" (vista Prédio). */
const LC = {el: null, key: null, fc: null};
function lotCardHl(l) {
  LC.fc = l ? {type: 'Feature', geometry: lotFeature(l), properties: {}} : EMPTY_FC;
  const H = MC; if (!H || !H.ready) return;
  const s = H.map.getSource('app-lot-sel'); if (s) s.setData(LC.fc);
}
function lotCardClose() { if (LC.el) LC.el.hidden = true; LC.key = null; lotCardHl(null); }
function lotCard(cd, l) {
  const H = MC, F = DFILE[cd]; if (!H || !F) return;
  let el = LC.el;
  if (!el || !H.host.contains(el)) {
    el = LC.el = document.createElement('div'); el.className = 'lotcard'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Vendas do lote');
    H.host.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-close],button[data-open]'); if (!b) return;
      if (b.dataset.close) lotCardClose();
      else { const [c, id] = b.dataset.open.split(':'); lotCardClose(); openLot(c, id); }
    });
  }
  LC.key = cd + ':' + l.id; el.hidden = false; lotCardHl(l);
  const d = F.deals, ks = lotDeals(F, l.i), grp = grpOf(l.t) || S.tipo, u = l.u;
  const nOk = ks.filter(k => d.ok[k]).length;
  el.innerHTML = `<button type="button" class="lc-x" data-close="1" aria-label="Fechar" title="Fechar (Esc)">×</button>` +
    `<div class="lc-h"><b>${esc(l.nm || l.end || 'Lote ' + l.id)}</b><span class="muted">${esc([l.nm && l.end ? l.end : null, dname(cd), TIPO_LB[l.t] || l.t].filter(Boolean).join(' · '))}</span>` +
    (u ? `<span class="muted">IPTU ${esc(M.iptu_perfil || '')}: ${nf0.format(u[0])} unid.${u[1] ? ` · ${nf0.format(u[1])} aptos` : ''}${u[3] ? ` · ${u[3]} pav.` : ''}${u[4] ? ` · ACC ${u[4]}` : ''}</span>` : '') + `</div>` +
    `<div class="lc-k"><span><b>${nf0.format(l.n)}</b> negócios · <b>${nf0.format(l.n5)}</b> em 5 anos · <b>${nf0.format(nOk)}</b> no preço</span>` +
    `<span><b>${l.p ? fPrice(l.p[2], grp) : '—'}</b>${l.p && baseOf(grp) === 'unid' ? ' por vaga' : ''} em 5 anos${l.p ? ` <small class="muted">IQR ${nf0.format(l.p[1])}–${nf0.format(l.p[3])} · n=${l.p[0]}</small>` : ' <small class="muted">(sem venda elegível)</small>'}</span></div>` +
    `<div id="lcChart" class="chart" style="height:170px"></div><p class="note lc-n">Pontos: negócios de ${esc((GRP_LB1[grp] || '').toLowerCase())} no lote (vazado = fora do preço); tracejado e faixa = mediana e IQR do distrito.</p>` +
    `<div class="tablewrap lc-t" id="lcDeals"></div>` +
    `<div class="lc-f"><button type="button" class="lc-btn" data-open="${esc(cd)}:${esc(l.id)}">Detalhes do lote →</button></div>`;
  safe('cartão: histórico', () => renderPHist(F, l, ks, grp, 'lcChart', true));
  safe('cartão: negócios', () => lotCardDeals(F, ks));
}
function lotCardDeals(F, ks) {
  const d = F.deals;
  const rows = ks.map(k => ({k, d: d.d[k], cp: d.cp[k], t: TIPO_OF[d.t[k]], a: areaOf(d, k), v: d.v[k], rs: rsOf(d, k), ok: d.ok[k], mo: d.mo[k]}));
  table($('lcDeals'), 'lcdeals', [
    {k: 'd', label: 'Data', f: r => fDate(r.d)}, {k: 'cp', label: 'Unidade', f: r => esc(r.cp || '—')},
    {k: 't', label: 'Tipo', f: r => `<span class="pill${r.t === 'planta' ? ' pl' : ''}">${esc(TIPO_LB[r.t] || r.t)}</span>`},
    {k: 'a', label: 'Área', n: 1, title: 'área construída do IPTU; para terreno, área do terreno', f: r => r.a ? nf0.format(r.a) + ' m²' : '—'},
    {k: 'v', label: 'Valor', n: 1, title: 'valor declarado na guia', f: r => fR(r.v)},
    {k: 'rs', label: 'Preço', n: 1, title: 'na base do tipo do negócio (R$/m² construído, R$/m² de terreno ou R$ por vaga); em cinza, fora do preço com o motivo',
      f: r => r.rs == null || r.t === 'planta' ? '—' : r.ok ? fPrice(r.rs, grpOf(r.t)) : `<span class="gray" title="${esc(MOT[r.mo] || 'fora do preço')}">${fPrice(r.rs, grpOf(r.t))}</span>`},
  ], rows, {sort: {k: 'd', d: 'desc'}, page: 6, pageKey: LC.key, rowAttr: r => r.ok ? '' : 'style="color:var(--muted)"'});
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && LC.key) lotCardClose(); });

/* ── busca por rua (30/09) ────────────────────────────────────────────────────────
   Índice estático ruas.json (build_data.py): logradouro das guias de ITBI → centróide, caixa, nº de negócios e os lotes com
   venda por distrito. Só o navegador: busca por prefixo normalizado (sem acento/caixa), no nome sem o tipo ("paulista"),
   no nome inteiro ("av paulista") ou no começo de qualquer palavra; até 8 sugestões, ordenadas por nº de negócios.
   Rua sem venda registrada não está no índice: aí o Nominatim (OpenStreetMap) entra como 2º recurso, com atribuição. */
const RU = {list: null, p: null, sel: null, selSets: null, hi: -1, items: [], t: 0, tN: 0, nomi: null};
const TIPO_LOGR_ABREV = new Set(['r', 'av', 'al', 'tv', 'pc', 'lg', 'es', 'vd', 'pte', 'rod', 'vl', 'jd', 'pq', 'bc', 'cam', 'psg', 'pas', 'ld', 'tun', 'mrg', 'prq', 'cj', 'acs', 'cpo', 'est', 'estr', 'tr', 'rua', 'avn', 'pr']);
function ruasLoad() {
  if (RU.p) return RU.p;
  return RU.p = loadJSON(M.ruas || 'ruas.json').then(j => {
    RU.list = j.ruas.map(r => {
      const norm = normTxt(r[9] || r[0]), w = norm.split(' ').filter(Boolean);
      const st = w.length > 1 && TIPO_LOGR_ABREV.has(w[0]) ? w.slice(1).join(' ') : norm;
      return {nome: r[0], c: [r[1], r[2]], bb: [[r[3], r[4]], [r[5], r[6]]], n: r[7], lots: r[8], norm, st, w};
    });
    return RU.list;
  }).catch(e => { RU.p = null; throw e; });
}
function ruasBusca(q, max = 8) {
  q = normTxt(q); if (!q || !RU.list) return [];
  const toks = q.split(' ').filter(Boolean), out = [];
  for (const r of RU.list) {
    let sc = null;
    if (r.st.startsWith(q)) sc = 0; else if (r.norm.startsWith(q)) sc = 1;
    else if (toks.every(t => r.w.some(w => w.startsWith(t)))) sc = 2;
    if (sc != null) out.push([sc, r]);
  }
  return out.sort((a, b) => a[0] - b[0] || b[1].n - a[1].n).slice(0, max).map(x => x[1]);
}
const ruaHas = (cd, i) => !!(RU.selSets && RU.selSets[cd] && RU.selSets[cd].has(i));
function ruaIr(r) {
  const inp = $('buscaRua'), list = $('buscaList'); if (inp) inp.value = r.nome; if (list) list.hidden = true;
  RU.sel = r; RU.selSets = {};
  Object.entries(r.lots).forEach(([cd, ds]) => { let x = 0; RU.selSets[cd] = new Set(ds.map(d => (x += d))); });   // índices em delta
  const nl = Object.values(RU.selSets).reduce((s, x) => s + x.size, 0);
  if (S.view !== 'cidade') setView('cidade');
  if (!camHas('lotes')) { S.cam.add('lotes'); render(); }
  const H = MC; if (H) H.fit({bounds: r.bb, padding: 60, maxZoom: 16.5, duration: 700, pitch: 0, bearing: 0});
  cityLotsRefresh();
  toast(`${r.nome}: ${nf0.format(r.n)} negócios em ${nf0.format(nl)} lotes (contorno escuro)`);
}
function ruaLimpar() { RU.sel = null; RU.selSets = null; if (MC) cityLotsRefresh(); }
function nominatim(q) {
  if (RU.nomi && RU.nomi.q === q) return;
  clearTimeout(RU.tN);
  RU.tN = setTimeout(() => {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&accept-language=pt-BR&viewbox=-46.83,-23.36,-46.36,-23.80&bounded=1&q=' + encodeURIComponent(q + ', São Paulo');
    fetch(url).then(r => r.ok ? r.json() : []).catch(() => []).then(js => {
      RU.nomi = {q, items: (js || []).map(o => ({nome: String(o.display_name || '').split(',').slice(0, 3).join(','), tipo: o.type, c: [+o.lon, +o.lat],
        bb: o.boundingbox ? [[+o.boundingbox[2], +o.boundingbox[0]], [+o.boundingbox[3], +o.boundingbox[1]]] : null}))};
      const inp = $('buscaRua'); if (inp && normTxt(inp.value) === normTxt(q)) buscaRender();
    });
  }, 700);
}
function buscaRender() {
  const inp = $('buscaRua'), list = $('buscaList'); if (!inp || !list) return;
  const q = inp.value.trim();
  if (q.length < 2) { list.hidden = true; list.innerHTML = ''; RU.items = []; return; }
  if (!RU.list) { list.hidden = false; list.innerHTML = '<div class="busca-n">Carregando o índice de ruas…</div>'; ruasLoad().then(buscaRender, () => { list.innerHTML = '<div class="busca-n">Índice de ruas indisponível (ruas.json).</div>'; }); return; }
  const loc = ruasBusca(q);
  RU.items = loc; RU.hi = loc.length ? 0 : -1;
  const nomi = RU.nomi && normTxt(RU.nomi.q) === normTxt(q) ? RU.nomi.items : null;
  list.innerHTML = loc.map((r, i) => { const cds = Object.keys(r.lots); return `<button type="button" role="option" data-i="${i}" aria-selected="${i === RU.hi}"><b>${esc(r.nome)}</b><small>${nf0.format(r.n)} negócios · ${esc(cds.slice(0, 3).map(dname).join(', '))}${cds.length > 3 ? ` +${cds.length - 3}` : ''}</small></button>`; }).join('') +
    (!loc.length ? `<div class="busca-n">Nenhuma rua com venda registrada começa assim.${q.length >= 4 && !nomi ? ' Procurando no OpenStreetMap…' : ''}</div>` : '') +
    (!loc.length && nomi ? (nomi.length ? `<div class="busca-g">OpenStreetMap (Nominatim) · endereço sem venda registrada</div>` + nomi.map((o, i) => `<button type="button" role="option" data-o="${i}"><b>${esc(o.nome)}</b><small>${esc(o.tipo || '')}</small></button>`).join('') : '<div class="busca-n">Nada no OpenStreetMap também.</div>') : '');
  list.hidden = false;
  if (!loc.length && q.length >= 4) nominatim(q);
}
function buscaInit() {
  const inp = $('buscaRua'), list = $('buscaList'), box = $('busca'); if (!inp || !list) return;
  // dentro da Central o menu lateral é o do dashboard: a busca vai para a barra do topo, ao lado do seletor de estrato
  if (document.documentElement.hasAttribute('data-embed') && box) { const top = document.querySelector('header.top'); if (top) top.insertBefore(box, top.querySelector('.estrato')); }
  inp.addEventListener('focus', () => { ruasLoad().catch(() => {}); if (inp.value.trim().length >= 2) buscaRender(); });
  inp.addEventListener('input', () => { clearTimeout(RU.t); if (!inp.value.trim()) ruaLimpar(); RU.t = setTimeout(buscaRender, 120); });
  inp.addEventListener('keydown', e => {
    const n = RU.items.length;
    if (e.key === 'ArrowDown' && n) { RU.hi = (RU.hi + 1) % n; e.preventDefault(); }
    else if (e.key === 'ArrowUp' && n) { RU.hi = (RU.hi - 1 + n) % n; e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (RU.hi >= 0 && RU.items[RU.hi]) ruaIr(RU.items[RU.hi]); else { const o = RU.nomi && RU.nomi.items[0]; if (o && normTxt(RU.nomi.q) === normTxt(inp.value)) nomiIr(o); } return; }
    else if (e.key === 'Escape') { list.hidden = true; return; }
    else return;
    list.querySelectorAll('button[data-i]').forEach((b, i) => b.setAttribute('aria-selected', String(i === RU.hi)));
  });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 160));
  list.addEventListener('mousedown', e => e.preventDefault());   // o clique na lista não tira o foco do campo antes de disparar
  list.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.i != null) ruaIr(RU.items[+b.dataset.i]);
    else if (b.dataset.o != null && RU.nomi) nomiIr(RU.nomi.items[+b.dataset.o]);
  });
}
function nomiIr(o) {
  const inp = $('buscaRua'), list = $('buscaList'); if (inp) inp.value = o.nome; if (list) list.hidden = true;
  ruaLimpar();
  if (S.view !== 'cidade') setView('cidade');
  const H = MC; if (H) H.fit(o.bb ? {bounds: o.bb, padding: 40, maxZoom: 16.5, duration: 700, pitch: 0, bearing: 0} : {center: o.c, zoom: 16, duration: 700, pitch: 0, bearing: 0});
  toast('Endereço do OpenStreetMap (Nominatim, ODbL): sem venda registrada nesse nome');
}

/* ── mapa da Cidade na altura da janela (30/09): do topo do mapa até a borda inferior, menos a legenda ── */
function sizeCityMap() {
  const el = $('mapCity'); if (!el || S.view !== 'cidade') return;
  const r = el.getBoundingClientRect(), leg = $('mapLegend');
  const h = Math.round(innerHeight - (r.top + scrollY) - (leg ? leg.offsetHeight : 0) - 34);
  const hh = Math.max(480, h) + 'px'; if (el.style.height !== hh) el.style.height = hh;
}
window.addEventListener('resize', rafThrottle(sizeCityMap));

/* ── rodapé: qualidade e regras ───────────────────────── */
function renderFooter() {
  $('footer').innerHTML = [
    `<div><b>Fonte</b>: Guias de ITBI pagas (Secretaria da Fazenda de SP), 2006 a ${M.last_date.slice(0, 7)}; IPTU (cadastro fiscal, GeoSampa) 2010–2026; lotes fiscais GeoSampa (set/2026); anúncios QuintoAndar (20/06/2026). Build ${esc(M.built)}.</div>`,
    `<div><b>Preço</b>: só negócios com SQL próprio (unidade individualizada), sem valor simbólico, sem venda em bloco, sem valor abaixo de 30% do VVR e dentro de 3,5·MAD por distrito × tipo × tamanho × ano. Mediana móvel de 12 meses; IC95% ≈ mediana ± 1,58·IQR/√n; n &lt; ${MIN} fica cinza.</div>`,
    `<div><b>Tipos</b>: apartamentos, casas, lojas/escritórios/comerciais e galpões em R$/m² de área <b>construída</b>; terrenos em R$/m² de área do <b>terreno</b>; vagas de garagem em R$ por <b>unidade</b>. O tipo vem do uso do IPTU que consta na guia; galpão = armazéns, depósitos e indústrias (usos 50 e 51).</div>`,
    `<div><b>Área</b>: construída do IPTU (inclui a fração das áreas comuns). Privativa ≈ construída ÷ 1,64 na mediana (IQR 1,32–1,90 entre prédios): nunca converta com fator único.</div>`,
    `<div><b>Planta</b>: unidades vendidas sobre o SQL do terreno (proporção &lt; 10%) entram no volume e na liquidez, nunca no R$/m². Antes de 2019 estão sub-representadas: os arquivos antigos da Prefeitura omitem guias de SQL já cancelado.</div>`,
    `<div><b>Mapa</b>: coordenada só do cadastro (SQL → IPTU → polígono do lote); nenhum geocoder por endereço. 91% dos negócios têm lote (97% com SQL próprio); o resto conta só nos agregados.</div>`,
    `<div><b>Atributos do IPTU</b> vêm do cadastro vigente quando a Prefeitura gerou o arquivo (não da data da venda): em vendas antigas, padrão/área/idade podem ser posteriores. Quartos: estimados dentro do prédio pelos anúncios (acerto 73–87%).</div>`,
  ].join('');
}

/* ── dica própria para [title] ──────────────────────────
   O tooltip nativo do navegador demora ~1 s e não aparece em alguns visualizadores (portal/WebView): o cursor vira "?" e nada
   acontece. Na 1ª passagem do mouse o texto sai de title para data-tt (sem dica dupla) e aparece num balão imediato. */
const TT = document.createElement('div'); TT.className = 'ttip'; TT.hidden = true; TT.setAttribute('role', 'tooltip'); document.body.appendChild(TT);
let ttEl = null;
function ttPlace(x, y) {
  const w = TT.offsetWidth, h = TT.offsetHeight, vw = innerWidth, vh = innerHeight;
  TT.style.left = Math.max(6, Math.min(vw - w - 6, x + 12)) + 'px';
  TT.style.top = (y + 18 + h > vh - 6 ? Math.max(6, y - h - 10) : y + 18) + 'px';
}
function ttShow(el, x, y) {
  if (el.hasAttribute('title')) { const t = el.getAttribute('title'); if (t) el.dataset.tt = t; el.removeAttribute('title'); }
  const t = el.dataset.tt; if (!t) { ttHide(); return; }
  ttEl = el; TT.textContent = t; TT.hidden = false; ttPlace(x, y);
}
function ttHide() { TT.hidden = true; ttEl = null; }
document.addEventListener('mouseover', e => {
  const el = e.target.closest ? e.target.closest('[title],[data-tt]') : null;
  if (!el || el === document.documentElement) { if (ttEl) ttHide(); return; }
  if (el !== ttEl) ttShow(el, e.clientX, e.clientY);
});
document.addEventListener('mousemove', rafThrottle(e => { if (ttEl && !TT.hidden) ttPlace(e.clientX, e.clientY); }));
document.addEventListener('mouseout', e => { if (ttEl && (!e.relatedTarget || !ttEl.contains(e.relatedTarget))) ttHide(); });
document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[title],[data-tt]'); if (el && el.matches(':focus-visible')) { const r = el.getBoundingClientRect(); ttShow(el, r.left, r.bottom - 8); } });
document.addEventListener('focusout', () => ttHide());
['scroll', 'mousedown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (ttEl) ttHide(); }, true));

/* depuração: __itbi.city.jumpTo({center: [lng, lat], zoom: 16}) */
window.__itbi = {get city() { return MC && MC.map; }, get comp() { return MP && MP.map; }, get S() { return S; }};

/* ── registros do núcleo ─────────────────────────────── */
registerView({id: 'cidade', label: 'Cidade', sub: 'mapa, distritos, trajetória', group: 'geo', order: 10, render: renderCidade});
registerView({id: 'quadrante', label: 'Quadrante', sub: 'nível × tendência do preço', group: 'geo', order: 20, render: renderQuad});
registerView({id: 'distrito', label: 'Distrito', sub: 'volume, preço, liquidez', group: 'geo', order: 30, ids: ['cd'], keepIds: true, render: renderDistrito});
registerView({id: 'predio', label: 'Prédio', sub: 'vendas, comparáveis, tipologia', group: 'geo', order: 40, ids: ['lotCd', 'lot'], keepIds: true, render: renderPredio});
registerLayer({id: 'lotes', core: true, group: 'Mercado secundário', order: 1, label: 'Lotes com venda', minzoom: 13, def: true,
  title: 'Lotes com negócios de SQL próprio (revenda e usados), coloridos pelo R$/m² mediano de 5 anos do tipo selecionado',
  legend: () => `<span class="it muted">zoom ≥ 13: lotes com venda de ${esc((GRP_LB[S.tipo] || TIPO_LB[S.tipo] || '').toLowerCase())} coloridos pelo ${esc(PU())} de 5 anos; outros tipos esmaecidos · ITBI até ${esc(M.last_date.slice(0, 10).split('-').reverse().join('/'))}</span>`});
registerLayer({id: 'planta', core: true, group: 'Mercado primário', order: 1, label: 'Vendas na planta (ITBI)', minzoom: 13, def: true,
  title: 'Lotes com unidades vendidas sobre o SQL do terreno (registro no ITBI; fora do R$/m²)',
  legend: () => `<span class="it"><i class="dot" style="border-radius:2px;background:var(--pl)"></i>lote com vendas na planta (registro ITBI sobre o terreno)</span>`});
registerPreset({id: 'preco', label: 'Preço', order: 10, met: 'preco', cam: ['lotes', 'planta'], title: 'R$/m² do estrato por distrito; lotes com venda e com planta'});

/* ── API para os módulos (src/m_*.js) ─────────────────── */
window.RADAR = {
  D, M, S, Q, QF, QR, NQ, LQ, MIN, FX, FXLB, DIMLB, TIPO_LB, TC, MOT, DIST, DCODES, DF, ANOS, LAST_FULL_Y, DFILE,
  $, esc, nf0, nf1, nf2, fR, fRm2, fMi, fDate, fSig, fPct, fInt, clamp, med, qt, css, mode, ramp, RAMP, DIVL, HEAT, VIOLET, ORANGE, PALS, gradCss,
  chart, base, ax, tip, table, kpi, nBadge, priceCell, dvCell, axM2, fxColors, fxColor, priceColor, varColor, heatColor,
  dname, skey, sLabel, ser, st, delta, geoStats, qAxis,
  TIPOS, GRP, GRP_LB, GRP_LB1, BASE, BASE_LB, DIMS_T, grpOf, baseOf, FXD, fxLab, PU, fPrice, rsOf, areaOf, lotCard, lotCardClose, ruasBusca, ruaIr,
  createBaseMap, wireMap, upsertSrc, addLayerOnce, visL, firstSymbol, rafThrottle, putImage, diamondImg, EMPTY_FC, lotFeature, decodeRings, haversine, BMAPS,
  fetchDist, loadJSON, safe, logErr, render, setView, openDist, openLot, camHas, setLayer, setMetric, toast, syncUrl, renderSections, badgesHtml, LAYER_GROUPS,
  renderLayerPanel, renderCityLegend, applyCity, normTxt,
  registerView, registerSection, registerBadge, registerMetric, registerLayer, registerPreset, registerParam, viewDef, viewOn, DISABLED,
  registerMapDecor, decorate, decorHits, decorTip, state: radarState,
  get city() { return MC; }, get cityMap() { return MC && MC.map; },
};
window.RADAR.start = function start() {
  if (STARTED) return; STARTED = true;
  const hasHash = /^#\//.test(location.hash) || /^#\w/.test(location.hash);
  if (!hasHash) loadPrefs();
  if (!S.cam) S.cam = defaultCam();
  stateFromHash();
  if (!DIST[S.cd]) S.cd = '62';
  if (!viewOn(S.view)) S.view = 'cidade';
  buildRail();
  buscaInit();
  render();
};

/* ── tema ─────────────────────────────────────────────── */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { BMAPS.forEach(H => H.onTheme()); render(); });
