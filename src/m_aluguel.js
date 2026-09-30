/* ════════ Radar ITBI · módulo ALUGUEL E YIELD (QuintoAndar · Inside Airbnb · FipeZAP) ════════
   Dados: aluguel/*.json (build_aluguel.py), carregados sob demanda, nunca embutidos no HTML.
   Regras (A5 · P-A5-n; A6 · H9/H15/H17):
   - QuintoAndar = foto única de 20/06/2026, preço PEDIDO, área ÚTIL; só agregados (distrito, hexágono, prédio com n),
     nunca um ponto por anúncio (P-A5-14). Selo "foto 20/06/2026 · pedido" em toda legenda e painel.
   - Cor = violeta de um só matiz (R.PALS.alug), nunca na mesma legenda da escala do ITBI.
   - Yield do mapa = yield da unidade (dupla oferta, P-A5-9); qaqa só quando n < 10, marcado. Yield sobre o fechamento
     do ITBI só como segundo número (tooltip, KPI, ranking), nunca cor (P-A5-10).
   - Inside Airbnb só por hexágono/distrito, citando CC BY 4.0 (P-A5-13). Mediana e IQR; n sempre visível. */
const {S, esc, nf0, nf1, nf2, css, ramp, clamp, tip, kpi, $} = R;
const MIN = R.MIN, FOTO = '20/06/2026';
const QS = ['≤1', '2', '3', '4+'], FA = ['≤35', '35–50', '50–70', '70–100', '100–150', '>150'];
const QLB = {'≤1': 'até 1 quarto', '2': '2 quartos', '3': '3 quartos', '4+': '4+ quartos'};
const QSH = {'≤1': '≤1 q.', '2': '2 q.', '3': '3 q.', '4+': '4+ q.'};
const ACC = ['≤1980', '1981–2000', '2001–2015', '2016–2022', '2023+'];
const AL = {D: null, idade: null, meta: null, hex: null, curta: null, fz: null, pred: {}, pp: {}, pidx: [], err: null, base: null, ph: null, pc: null, pf: null};
const MY_METS = ['alug_m2', 'yield'];
const PC = 'app-aluguel-', PR = 'app-alr-';   // camadas: mapa da Cidade · mapa do radar
const selo = () => `<span class="al-selo" title="QuintoAndar: foto única de ${FOTO}; preço pedido (não fechado); área útil do anúncio; só agregados">foto ${FOTO} · pedido</span>`;
const fAm2 = v => v == null ? '—' : 'R$ ' + nf1.format(v) + '/m²';
const fY = v => v == null ? '—' : nf1.format(v) + '%';
const fRs = v => v == null ? '—' : 'R$ ' + nf0.format(v);
const fN = v => v == null ? '—' : nf0.format(v);
const fK = v => v == null ? '—' : v >= 1e6 ? 'R$ ' + nf2.format(v / 1e6) + ' mi' : v >= 1e4 ? 'R$ ' + nf0.format(v / 1e3) + ' mil' : v >= 1e3 ? 'R$ ' + nf1.format(v / 1e3) + ' mil' : 'R$ ' + nf0.format(v);
const fPctS = v => v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '±') + nf0.format(Math.abs(v)) + '%';
const fPct1 = v => v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '±') + nf1.format(Math.abs(v)) + '%';
/* limites "redondos" para eixo linear (evita 3.985 / 154 nas pontas) */
function niceBounds(lo, hi, n = 4) {
  const raw = (hi - lo) / n || 1, p10 = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(k => k * p10).find(k => k >= raw) || 10 * p10;
  return {min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step};
}
const LOGX = [1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000, 15000, 20000, 30000, 40000], LOGXS = [1000, 2000, 3000, 5000, 10000, 20000, 30000];
const LOGY = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250];
const hexSvg = (fill, stroke, dash) => `<svg width="12" height="13" viewBox="0 0 12 13" aria-hidden="true"><path d="M6 .8 11 3.7v5.6L6 12.2 1 9.3V3.7z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${dash ? ' stroke-dasharray="2 1.4"' : ''}/></svg>`;

/* ── dados ─────────────────────────────────────────────── */
function zipRows(f, d) {
  const o = {};
  for (const cd in d) { o[cd] = {}; for (const k in d[cd]) { const a = d[cd][k], r = {}; f.forEach((n, i) => { r[n] = a[i]; }); o[cd][k] = r; } }
  return o;
}
function loadBase() {
  if (AL.base) return AL.base;
  return AL.base = Promise.all([R.loadJSON('aluguel/distrito.json'), R.loadJSON('aluguel/meta.json')]).then(([d, m]) => {
    AL.D = zipRows(d.f, d.d); AL.idade = d.idade; AL.meta = m; AL.err = null;
  }).catch(e => { AL.err = String(e && e.message || e); AL.base = null; throw e; });
}
function ringOf(hq, hr) {
  const M = AL.meta.hex, s = M.size;
  const x = s * Math.sqrt(3) * (hq + hr / 2), y = s * 1.5 * hr, clat = M.lat0 + y / M.ky, clon = M.lon0 + x / M.kx;
  const ring = [];
  for (let k = 0; k < 6; k++) { const a = (60 * k + 30) * Math.PI / 180; ring.push([+(clon + s * Math.cos(a) / M.kx).toFixed(6), +(clat + s * Math.sin(a) / M.ky).toFixed(6)]); }
  ring.push(ring[0]);
  return {ring, c: [clon, clat]};
}
function loadHex() {
  if (AL.ph) return AL.ph;
  return AL.ph = loadBase().then(() => R.loadJSON('aluguel/hex.json')).then(j => {
    j.hex.forEach((h, i) => { const g = ringOf(h.h[0], h.h[1]); h._ring = g.ring; h._c = g.c; h._i = i; });
    AL.hex = j; return j;
  }).catch(e => { AL.ph = null; throw e; });
}
function loadCurta() {
  if (AL.pc) return AL.pc;
  return AL.pc = loadBase().then(() => R.loadJSON('aluguel/curta.json')).then(j => {
    j.byId = {};
    j.hex.forEach((h, i) => { const g = ringOf(h.h[0], h.h[1]); h._ring = g.ring; h._c = g.c; h._i = i; j.byId[h.h[0] + '_' + h.h[1]] = h; });
    AL.curta = j; return j;
  }).catch(e => { AL.pc = null; throw e; });
}
function loadFz() { return AL.pf || (AL.pf = R.loadJSON('aluguel/fipezap.json').then(j => { AL.fz = j; return j; }).catch(e => { AL.pf = null; throw e; })); }
function loadPred(cd) {
  if (AL.pred[cd]) return Promise.resolve(AL.pred[cd]);
  if (AL.pp[cd]) return AL.pp[cd];
  return AL.pp[cd] = R.loadJSON('aluguel/predios/' + cd + '.json').then(j => {
    j.p.forEach(p => { p.i = AL.pidx.length; p.cd = cd; AL.pidx.push(p); });
    AL.pred[cd] = j.p; delete AL.pp[cd]; return j.p;
  }).catch(() => { AL.pred[cd] = []; delete AL.pp[cd]; return []; });   // distrito sem anúncio de aluguel (Parelheiros, Marsilac)
}
const needsAl = () => ['aluguel', 'distrito', 'predio'].includes(S.view) || (S.view === 'cidade' && (MY_METS.includes(S.met) || R.camHas('aluguel')));
loadBase().then(() => { if (needsAl()) R.render(); }).catch(() => { if (needsAl()) R.render(); });

/* ── estrato do aluguel: grupo (apto|casa) × quartos (seletor do topo) ou faixa de área útil (chips do radar) ── */
const grupo = () => S.tipo === 'casa' ? 'casa' : S.tipo === 'apto' ? 'apto' : null;
function strat(inRadar) {
  const g = grupo(); let dim = 'todos', fx = 'todos';
  const fu = inRadar ? (S.p.alFu || '*') : '*';
  if (fu !== '*') { dim = 'area_util'; fx = fu; }
  else if (g === 'apto' && S.dim === 'quartos' && S.fx !== '*') { dim = 'quartos'; fx = S.fx === '1' ? '≤1' : S.fx; }
  return {g, dim, fx, key: g ? `${g}|${dim}|${fx}` : null, tot: g ? `${g}|todos|todos` : null};
}
function stratLabel(st) {
  if (!st.g) return 'Sala/flat comercial: sem aluguel residencial';
  return (st.g === 'apto' ? 'Apartamento' : 'Casa') + ' · ' + (st.dim === 'quartos' ? QLB[st.fx] + (st.fx === '≤1' ? ' (inclui studio)' : '')
    : st.dim === 'area_util' ? st.fx + ' m² útil' : 'todas as faixas');
}
const drow = (cd, key) => AL.D && key && AL.D[cd] ? AL.D[cd][key] || null : null;

/* ── medidas (uma escala violeta por mapa; domínio fixo por grupo = legendas comparáveis entre estratos) ── */
const MED = {
  alug_m2: {label: 'Aluguel R$/m²', long: 'Aluguel R$/m² útil/mês', log: true, dom: g => g === 'casa' ? [12, 60] : [25, 150], fmt: fAm2, short: v => nf0.format(v)},
  aluguel: {label: 'Aluguel/mês', long: 'Aluguel pedido, R$/mês', log: true, dom: g => g === 'casa' ? [900, 15000] : [1200, 12000], fmt: fRs, short: fK},
  custo: {label: 'Custo de morar', long: 'Custo de morar (aluguel + condomínio + IPTU), R$/mês', log: true, dom: g => g === 'casa' ? [1000, 16000] : [1500, 16000], fmt: fRs, short: fK},
  yield: {label: 'Yield', long: 'Yield bruto da unidade, % a.a.', log: false, dom: () => [5.5, 9.5], fmt: fY, short: v => nf1.format(v) + '%'},
  oferta: {label: 'Oferta por 1.000', long: 'Anúncios de aluguel por 1.000 unidades (IPTU)', log: true, dom: g => g === 'casa' ? [0.5, 20] : [1, 60], fmt: v => v == null ? '—' : nf1.format(v) + ' por mil', short: v => nf0.format(v)},
};
const MKEYS = Object.keys(MED);
const radMed = () => (MED[S.p.alMed] ? S.p.alMed : 'yield');
function tOf(med, g, v) { const M = MED[med], [lo, hi] = M.dom(g || 'apto'); return M.log ? (Math.log(Math.max(v, 1e-9)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo); }
const colOf = (med, g, v, stops) => v == null ? null : ramp(stops || R.PALS.alug(), clamp(tOf(med, g, v), 0, 1));
/* valor de um distrito: {v, n, ok, fb (yield estimado pelo qaqa)} */
function dval(r, med, rt) {
  if (med === 'oferta') { const t = rt || r; return t && t.of != null ? {v: t.of, n: t.nb, ok: (t.est || 0) >= 500} : null; }
  if (!r) return null;
  if (med === 'alug_m2') return r.p50 == null ? null : {v: r.p50, n: r.n, ok: r.n >= MIN};
  if (med === 'aluguel') return r.al == null ? null : {v: r.al, n: r.n, ok: r.n >= MIN};
  if (med === 'custo') return r.cm == null ? null : {v: r.cm, n: r.cmn, ok: r.cmn >= MIN};
  if (r.yn >= MIN && r.y != null) return {v: r.y, n: r.yn, ok: true};
  if (r.yq != null) return {v: r.yq, n: r.yn, ok: true, fb: true};
  return r.y != null ? {v: r.y, n: r.yn, ok: false} : null;
}
/* hexágono: c = [n, p25, p50, p75, aluguel, custo, yu_n, yu, venda_n, venda_m2, n_bruto] */
function hval(h, st, med) {
  if (med === 'oferta') { const c = h.c[st.tot], est = h.e[st.g === 'casa' ? 1 : 0]; return c ? (est >= 200 ? {v: 1000 * c[10] / est, n: c[10], ok: true, est} : {v: null, n: c[10], ok: false, est}) : null; }
  const c = h.c[st.key]; if (!c) return null;
  const [n, , p50, , al, cm, yn, y, vn, v] = c;
  if (med === 'alug_m2') return {v: p50, n, ok: n >= MIN && p50 != null};
  if (med === 'aluguel') return {v: al, n, ok: n >= MIN && al != null};
  if (med === 'custo') return {v: cm, n, ok: n >= MIN && cm != null};
  if (yn >= MIN && y != null) return {v: y, n: yn, ok: true};
  if (n >= MIN && vn >= MIN && p50 && v) return {v: 1200 * p50 / v, n: yn, ok: true, fb: true};
  return {v: y, n: yn, ok: false};
}
/* prédio: m[key] = [n, p25, p50, p75, aluguel, custo, yu_n, yu]; cinza abaixo de 3 anúncios no preço */
function pval(p, st, med) {
  const c = p.m[st.key]; if (!c || !c[0]) return null;
  const [n, , p50, , al, cm, yn, y] = c, o = {n0: n, n};
  if (med === 'oferta') return Object.assign(o, {v: p.s.of == null ? null : p.s.of, ok: p.s.of != null});
  if (med === 'alug_m2') return Object.assign(o, {v: p50, ok: n >= 3 && p50 != null});
  if (med === 'aluguel') return Object.assign(o, {v: al, ok: n >= 3 && al != null});
  if (med === 'custo') return Object.assign(o, {v: cm, ok: n >= 3 && cm != null});
  if (yn >= 3 && y != null) return Object.assign(o, {v: y, n: yn, ok: true});
  if (st.dim === 'todos' && p.s.yq != null) return Object.assign(o, {v: p.s.yq, ok: true, fb: true});
  return Object.assign(o, {v: y, n: yn, ok: false});
}

/* ── tooltips ──────────────────────────────────────────── */
function metTip(cd, inRadar) {
  if (!AL.D) return tip(R.dname(cd), [['Aluguel (QuintoAndar)', AL.err ? 'indisponível: abra pelo serve.py' : 'carregando…']]);
  const st = strat(inRadar);
  if (!st.g) return tip(R.dname(cd), [['Aluguel', 'só Apartamento e Casa']], `QuintoAndar · foto ${FOTO}`);
  const r = drow(cd, st.key), rt = drow(cd, st.tot), foot = `${stratLabel(st)} · QuintoAndar, foto ${FOTO} · preço pedido · área útil · clique para abrir o distrito`;
  if (!r || r.n == null) return tip(R.dname(cd), [[stratLabel(st), 'sem anúncio de aluguel']], foot);
  const y = dval(r, 'yield');
  return tip(R.dname(cd), [
    ['Aluguel R$/m² útil/mês', fAm2(r.p50) + (r.n >= MIN ? '' : ' (n baixo)')],
    ['Faixa interquartil', r.p25 != null ? `${nf1.format(r.p25)} – ${nf1.format(r.p75)}` : '—'],
    ['n (anúncios no preço)', fN(r.n)],
    ['Aluguel/mês (mediana)', fRs(r.al)],
    ['Custo de morar (aluguel + cond. + IPTU)', fRs(r.cm) + (r.peso != null ? ` · cond.+IPTU ${nf0.format(r.peso)}%` : '')],
    ['Yield da unidade', y && y.v != null ? `${fY(y.v)}${y.fb ? ' (estimado, qaqa)' : r.y25 != null ? ` [${nf1.format(r.y25)}–${nf1.format(r.y75)}]` : ''} · n=${fN(r.yn)}` : '—'],
    ['≈ Yield no fechamento ITBI', r.yi != null ? `${fY(r.yi)} · ${fN(r.yin)} prédios` : '—'],
    ['Anúncios por 1.000 unid.', rt && rt.of != null ? nf1.format(rt.of) + ' (presença, não vacância)' : '—'],
  ], foot);
}
function curtaRows(c) {
  if (!c) return [];
  return [['Airbnb no hexágono', `${fN(c.n)} anúncios · ${fN(c.at)} ativos 12 m`],
    ['Airbnb ÷ aluguel QuintoAndar', c.rz != null ? nf1.format(c.rz) + '× (anúncios)' : `— (${fN(c.nq)} anúncios QA)`],
    ['Diária mediana (imóvel inteiro)', c.di != null ? fRs(c.di) + ` · n=${fN(c.ni)}` : '—'],
    ['Noites/mês p/ empatar (≤1 quarto)', c.ne != null ? nf1.format(c.ne) + ` (aluguel ${fRs(c.a1)} ÷ diária ${fRs(c.d1)})` : '— (n < 10 num dos lados)'],
    ['Operadores com 5+ anúncios', c.mu != null ? c.mu + '%' : '—']];
}
function hexTip(h, st, med, withCurta) {
  const c = h.c[st.key], ct = h.c[st.tot], v = hval(h, st, med);
  const rows = [];
  if (c) {
    const [n, p25, p50, p75, al, cm, yn, y, vn, vv] = c;
    rows.push(['Aluguel R$/m² útil/mês', fAm2(p50) + (n >= MIN ? '' : ' (n < 10)')], ['IQR', p25 != null ? `${nf1.format(p25)} – ${nf1.format(p75)}` : '—'],
      ['n (anúncios no preço)', fN(n)], ['Aluguel/mês · custo de morar', `${fRs(al)} · ${fRs(cm)}`],
      ['Yield da unidade', y != null ? `${fY(y)} · n=${fN(yn)}${yn < MIN ? ' (baixo)' : ''}` : v && v.fb ? `${fY(v.v)} (estimado, qaqa)` : '—'],
      ['Venda pedida R$/m² útil', vv != null ? fRs(vv) + ` · n=${fN(vn)}` : '—']);
  } else rows.push([stratLabel(st), 'sem anúncio do estrato']);
  if (med === 'oferta' && v) rows.push(['Oferta por 1.000 unid.', v.ok ? nf1.format(v.v) + ` (estoque ${fN(v.est)})` : `— (estoque ${fN(v.est)} < 200)`]);
  rows.push(['Anúncios de aluguel (todos) · prédios', `${fN(h.nb)} · ${fN(h.np)}`]);
  if (withCurta && AL.curta) { const k = AL.curta.byId[h.h[0] + '_' + h.h[1]]; if (k) rows.push(...curtaRows(k).map(r => ['· ' + r[0], r[1]])); }
  return tip(`Hexágono ~500 m · ${R.dname(h.cd)}`, rows, `${stratLabel(st)} · QuintoAndar, foto ${FOTO} · pedido${withCurta ? ' · Airbnb: Inside Airbnb 14/06/2026, CC BY 4.0' : ''} · clique para aproximar`);
}
function predName(p) { return p.nm || p.end || (p.g === 'p' ? 'Ponto fora de lote' + (p.bairro ? ' · ' + p.bairro : '') : 'Lote ' + (p.lot || '')); }
function predTip(p, st, med) {
  const c = p.m[st.key], s = p.s, v = pval(p, st, med);
  const rows = [];
  if (c) rows.push(['Aluguel R$/m² útil/mês', fAm2(c[2]) + ` · n=${fN(c[0])}${c[0] < 3 ? ' (baixo)' : ''}`], ['Aluguel/mês · custo de morar', `${fRs(c[4])} · ${fRs(c[5])}`]);
  rows.push(['Anúncios no prédio', `${fN(p.nb)} aluguel · ${fN(p.nv)} venda`]);
  rows.push(['Yield da unidade', c && c[6] > 0 && c[7] != null ? `${fY(c[7])} · n=${fN(c[6])} unid.${c[6] < 3 ? ' (baixo)' : ''}`
    : s.y != null ? `${fY(s.y)} · n=${fN(s.yn)} (prédio, todas as tipologias)` : v && v.fb ? `${fY(v.v)} (estimado, qaqa)` : '—']);
  rows.push(['≈ Yield no fechamento ITBI', s.yi != null ? `${fY(s.yi)} · ${fN(s.in)} vendas` : '—']);
  if (s.of != null) rows.push(['Oferta por 1.000 unid.', `${nf1.format(s.of)} (${fN(s.nu)} unid. IPTU)${p.conc ? ' · concentrada' : ''}`]);
  if (s.pv != null) rows.push(['Prêmio sobre a vizinhança (500 m)', fPctS(s.pv)]);
  const foot = p.d ? 'clique para abrir o prédio' : p.lot ? 'lote sem venda no ITBI: sem página de prédio' : 'ponto nativo fora de lote: sem página de prédio';
  return tip(predName(p), rows, `${stratLabel(st)} · QuintoAndar, foto ${FOTO} · pedido · ${foot}`);
}
function layerTip(f, where) {
  const id = f.layer.id, pr = f.properties, inR = where === 'radar';
  const st = strat(inR), med = inR ? radMed() : layerMed();
  if (id.endsWith('pred-c')) { const p = AL.pidx[pr.i]; return p ? predTip(p, st, med) : null; }
  if (id.endsWith('hex-fill')) { const h = AL.hex && AL.hex.hex[pr.i]; return h ? hexTip(h, st, med, inR ? !!S.p.alAb : R.camHas('aluguel:curta')) : null; }
  if (id.endsWith('curta-hit')) { const c = AL.curta && AL.curta.hex[pr.i]; return c ? tip('Hexágono ~500 m · Airbnb', curtaRows(c), 'Inside Airbnb, 14/06/2026 (CC BY 4.0) · ponto deslocado até ~150 m: só hexágono') : null; }
  return null;
}
function miniToast(H, msg) {
  let t = H.host.querySelector('.al-toast'); if (!t) { t = document.createElement('div'); t.className = 'al-toast'; t.setAttribute('role', 'status'); H.host.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, 4000);
}
function layerClick(f, H) {
  const id = f.layer.id, pr = f.properties;
  if (id.endsWith('pred-c')) {
    const p = AL.pidx[pr.i]; if (!p) return;
    if (p.d) R.openLot(p.d, p.lot);
    else miniToast(H, p.lot ? 'Lote sem venda no ITBI: sem página de prédio (os agregados de aluguel estão no tooltip)' : 'Anúncios fora de lote cadastral (ponto nativo): sem página de prédio');
    return;
  }
  const h = id.endsWith('hex-fill') ? AL.hex && AL.hex.hex[pr.i] : AL.curta && AL.curta.hex[pr.i];
  if (h) H.map.easeTo({center: h._c, zoom: id.endsWith('hex-fill') ? 15.3 : 14});
}

/* ── camadas (as mesmas no mapa da Cidade e no mapa do radar) ── */
function ensureLayers(map, P, below, withDist) {
  const E = R.EMPTY_FC;
  ['hex', 'pred', 'curta'].concat(withDist ? ['dist'] : []).forEach(s => R.upsertSrc(map, P + s, E, true));
  if (withDist) {
    R.putImage(map, 'al-hatch', hatchImg());
    R.addLayerOnce(map, {id: P + 'dist-fill', type: 'fill', source: P + 'dist', maxzoom: 12, paint: {'fill-color': ['get', 'fc'], 'fill-opacity': ['get', 'op']}}, below);
    R.addLayerOnce(map, {id: P + 'dist-hatch', type: 'fill', source: P + 'dist', maxzoom: 12, filter: ['==', ['get', 'nd'], 1], paint: {'fill-pattern': 'al-hatch'}}, below);
    R.addLayerOnce(map, {id: P + 'dist-line', type: 'line', source: P + 'dist', layout: {'line-join': 'round'}, paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 1.6]}}, below);
    map.setPaintProperty(P + 'dist-line', 'line-color', ['step', ['zoom'], css('--surface'), 12, css('--ink-2')]);
    map.setPaintProperty(P + 'dist-line', 'line-opacity', ['step', ['zoom'], 1, 12, 0.45]);
  }
  R.addLayerOnce(map, {id: P + 'curta-hit', type: 'fill', source: P + 'curta', paint: {'fill-color': '#000000', 'fill-opacity': 0}}, below);
  R.addLayerOnce(map, {id: P + 'hex-fill', type: 'fill', source: P + 'hex', maxzoom: 15, paint: {'fill-color': ['get', 'fc'], 'fill-opacity': ['case', ['==', ['get', 'ok'], 1], 0.8, 0]}}, below);
  R.addLayerOnce(map, {id: P + 'hex-line', type: 'line', source: P + 'hex', maxzoom: 15, paint: {}}, below);
  R.addLayerOnce(map, {id: P + 'curta-line', type: 'line', source: P + 'curta', filter: ['>=', ['get', 'n'], 10], layout: {'line-join': 'round'}, paint: {'line-dasharray': [2, 1.5]}});
  R.addLayerOnce(map, {id: P + 'pred-c', type: 'circle', source: P + 'pred', minzoom: 15, layout: {'circle-sort-key': ['-', 0, ['get', 'r']]}, paint: {}});
  map.setPaintProperty(P + 'hex-line', 'line-color', ['case', ['==', ['get', 'ok'], 1], css('--surface'), css('--ink-2')]);
  map.setPaintProperty(P + 'hex-line', 'line-width', ['case', ['==', ['get', 'ok'], 1], 0.5, 0.9]);
  map.setPaintProperty(P + 'hex-line', 'line-opacity', ['case', ['==', ['get', 'ok'], 1], 0.85, 0.6]);
  map.setPaintProperty(P + 'curta-line', 'line-color', css('--ink'));
  map.setPaintProperty(P + 'curta-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, ['*', 0.4, ['get', 'w']], 12.5, ['get', 'w']]);
  map.setPaintProperty(P + 'curta-line', 'line-opacity', ['interpolate', ['linear'], ['zoom'], 10, 0.55, 12.5, 0.85]);
  map.setPaintProperty(P + 'pred-c', 'circle-color', ['get', 'fc']);
  map.setPaintProperty(P + 'pred-c', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 15, ['get', 'r'], 18, ['*', 1.8, ['get', 'r']]]);
  map.setPaintProperty(P + 'pred-c', 'circle-opacity', ['case', ['==', ['get', 'out'], 1], 0.55, 0.92]);
  map.setPaintProperty(P + 'pred-c', 'circle-stroke-color', ['case', ['==', ['get', 'ring'], 1], css('--ink'), css('--surface')]);
  map.setPaintProperty(P + 'pred-c', 'circle-stroke-width', ['case', ['==', ['get', 'ring'], 1], 1.6, ['==', ['get', 'out'], 1], 0.5, 1]);
  map.setPaintProperty(P + 'pred-c', 'circle-stroke-opacity', ['case', ['==', ['get', 'gray'], 1], 0.45, 0.95]);
}
/* hachura = fora da cobertura (sem anúncio do estrato: não sabemos, não é aluguel zero) — A6 · H11 */
function hatchImg() {
  const n = 16, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); g.strokeStyle = css('--muted'); g.globalAlpha = 0.7; g.lineWidth = 1.4; g.beginPath();
  [[0, n, n, 0], [-n / 2, n / 2, n / 2, -n / 2], [n / 2, n * 1.5, n * 1.5, n / 2]].forEach(([a, b, c2, d]) => { g.moveTo(a, b); g.lineTo(c2, d); });
  g.stroke();
  return g.getImageData(0, 0, n, n);
}
function hexFC(med, st, only10) {
  if (!AL.hex || !st.g) return R.EMPTY_FC;
  const feats = [], gray = css('--gray-cell'), stops = R.PALS.alug();
  for (const h of AL.hex.hex) {
    const v = hval(h, st, med); if (!v) continue;
    const ok = v.ok && v.v != null; if (only10 && !ok) continue;
    feats.push({type: 'Feature', geometry: {type: 'Polygon', coordinates: [h._ring]}, properties: {i: h._i, ok: ok ? 1 : 0, fc: ok ? colOf(med, st.g, v.v, stops) : gray}});
  }
  return {type: 'FeatureCollection', features: feats};
}
function predFC(med, st, cds) {
  if (!st.g) return R.EMPTY_FC;
  const feats = [], gray = css('--gray-cell'), stops = R.PALS.alug();
  cds.forEach(cd => (AL.pred[cd] || []).forEach(p => {
    const v = pval(p, st, med); if (!v) return;
    feats.push({type: 'Feature', geometry: {type: 'Point', coordinates: p.c}, properties: {i: p.i, r: +(3 + 1.9 * Math.sqrt(v.n0)).toFixed(1),
      ring: (p.s.yn || 0) > 0 ? 1 : 0, out: p.g === 'p' ? 1 : 0, gray: v.ok && v.v != null ? 0 : 1, fc: v.ok && v.v != null ? colOf(med, st.g, v.v, stops) : gray}});
  }));
  return {type: 'FeatureCollection', features: feats};
}
function curtaFC() {
  if (!AL.curta) return R.EMPTY_FC;
  return {type: 'FeatureCollection', features: AL.curta.hex.map(h => ({type: 'Feature', geometry: {type: 'Polygon', coordinates: [h._ring]},
    properties: {i: h._i, n: h.n, w: h.rz == null ? 0.7 : h.rz >= 2 ? 3.2 : h.rz >= 1 ? 1.8 : 0.8}}))};
}
function cdsInView(map) {
  const b = map.getBounds(), bb = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  return R.DCODES.filter(cd => { const q = R.DIST[cd].bb; return !(q[2] < bb[0] || q[0] > bb[2] || q[3] < bb[1] || q[1] > bb[3]); }).slice(0, 8);
}
function symbolsLegend(med) {
  return `<span class="it">${hexSvg('var(--al-4)', 'var(--surface)')}hexágono ~500 m, n ≥ 10 (zoom 12–14)</span>` +
    `<span class="it">${hexSvg('none', 'var(--ink-2)')}n &lt; 10: só contorno</span>` +
    `<span class="it"><i class="al-pdot"></i>prédio (zoom ≥ 15): área = nº de anúncios · anel = tem yield da unidade</span>` +
    `<span class="it"><i class="al-pdot s"></i>esmaecido = ponto fora de lote · cinza = &lt; 3 anúncios</span>` +
    (med === 'oferta' ? `<span class="it muted">oferta = presença da plataforma e liquidez, não vacância (ρ = 0,90 com o giro do ITBI): compare dentro do distrito</span>` : '') +
    (med === 'yield' ? `<span class="it muted">yield da unidade (pedido ÷ pedido, mesma unidade); “qaqa” (medianas) só onde n &lt; 10, marcado no tooltip</span>` : '');
}
const curtaLegend = () => `<span class="it">${hexSvg('none', 'var(--ink)', true)}Airbnb (n ≥ 10): traço mais grosso = mais anúncios Airbnb por anúncio de aluguel QA (&lt;1× · 1–2× · ≥2×) · Inside Airbnb 14/06/2026 · <span class="lic">CC BY 4.0</span></span>`;
function scaleHtml(med, st) {
  const M = MED[med], [lo, hi] = M.dom(st.g || 'apto');
  return `<span class="scale"><b style="font-weight:500;color:var(--ink)">${esc(M.long)} · ${esc(stratLabel(st))}</b> ${esc(M.short(lo))}<span class="g" style="background:${R.gradCss(R.PALS.alug())}"></span>${esc(M.short(hi))}${M.log ? ' (log)' : ''}</span>`;
}

/* ── camada "Aluguel" no mapa da Cidade ── */
let cityCds = [];
const layerMed = () => (MY_METS.includes(S.met) ? S.met : R.camHas('aluguel:yield') ? 'yield' : 'alug_m2');
const cityActive = () => R.camHas('aluguel') && (S.met === 'none' || MY_METS.includes(S.met));
function cityUpdate(H) {
  const map = H.map; if (!cityActive() || !map.getSource(PC + 'hex')) return;
  const wantC = R.camHas('aluguel:curta');
  const miss = [];
  if (!AL.hex) miss.push(loadHex());
  if (wantC && !AL.curta) miss.push(loadCurta());
  const z = map.getZoom(), cds = z >= 14.5 ? cdsInView(map) : [];
  cds.forEach(cd => { if (!AL.pred[cd]) miss.push(loadPred(cd)); });
  if (miss.length) Promise.allSettled(miss).then(() => { if (S.view === 'cidade' && cityActive()) { cityUpdate(H); if (!AL._cityOnce) { AL._cityOnce = 1; R.render(); } } });
  cityCds = cds;
  const st = strat(false), med = layerMed();
  map.getSource(PC + 'hex').setData(hexFC(med, st, false));
  map.getSource(PC + 'pred').setData(predFC(med, st, cds));
  map.getSource(PC + 'curta').setData(wantC ? curtaFC() : R.EMPTY_FC);
  const z0 = MY_METS.includes(S.met) ? 12 : 0;
  map.setLayerZoomRange(PC + 'hex-fill', z0, 15); map.setLayerZoomRange(PC + 'hex-line', z0, 15);
}
function cityVisible(H, on) {
  const act = on && cityActive(), cu = act && R.camHas('aluguel:curta');
  [PC + 'hex-fill', PC + 'hex-line', PC + 'pred-c'].forEach(id => R.visL(H.map, id, act));
  [PC + 'curta-line', PC + 'curta-hit'].forEach(id => R.visL(H.map, id, cu));
}
function cityLegend() {
  if (!cityActive()) return `<span class="it muted">Aluguel desligado enquanto a cor dos distritos for do ITBI (uma escala contínua por vez): escolha “nenhuma” ou uma cor de aluguel.</span>`;
  const st = strat(false), med = layerMed();
  return (MY_METS.includes(S.met) ? `<span class="it muted">hexágonos e prédios na mesma escala dos distritos</span>` : scaleHtml(med, st) + selo()) +
    symbolsLegend(med) + (R.camHas('aluguel:curta') ? curtaLegend() : '') + (AL.err ? `<span class="it muted">Aluguel indisponível: abra pela URL do serve.py.</span>` : '');
}
R.registerLayer({
  id: 'aluguel', group: 'Aluguel', order: 10, label: 'Aluguel: hexágonos e prédios', fill: true,
  title: `Aluguel pedido (QuintoAndar, foto de ${FOTO}): hexágonos de ~500 m (zoom 12–14; sem cor de distrito, desde o zoom baixo) e prédios (zoom ≥ 15). Só agregados.`,
  subs: [{id: 'yield', label: 'cor pelo yield da unidade (senão R$/m²)', def: false},
    {id: 'curta', html: 'Airbnb por hexágono <span class="lic">CC BY 4.0</span>', def: false}],
  add: (H, below) => ensureLayers(H.map, PC, below, false),
  update: H => cityUpdate(H),
  setVisible: (H, on) => cityVisible(H, on),
  onMove: H => cityUpdate(H),
  hitLayers: () => [PC + 'pred-c', PC + 'hex-fill', PC + 'curta-hit'],
  tip: f => layerTip(f, 'city'),
  click: f => layerClick(f, R.city),
  legend: cityLegend,
  note: () => `${selo()} só agregados; a cor segue a do distrito quando ela é de aluguel`,
});

/* ── cor dos distritos (mapa da Cidade) ── */
R.registerMetric({id: 'alug_m2', label: 'Aluguel R$/m²', group: 'Aluguel (QuintoAndar)', order: 10, palette: 'alug', log: true,
  title: `Aluguel pedido mediano, R$/m² de área útil por mês, do estrato (QuintoAndar, foto de ${FOTO}); cinza = n < ${MIN}`,
  value: cd => { const v = dval(drow(cd, strat(false).key), 'alug_m2'); return v ? v.v : null; },
  ok: cd => { const v = dval(drow(cd, strat(false).key), 'alug_m2'); return !!(v && v.ok); },
  fmt: v => 'R$ ' + nf0.format(v), domain: () => MED.alug_m2.dom(grupo()),
  legendLabel: () => `Aluguel R$/m² útil/mês · ${stratLabel(strat(false))} · QuintoAndar, foto ${FOTO} · pedido`,
  tip: cd => metTip(cd, false)});
R.registerMetric({id: 'yield', label: 'Yield', group: 'Aluguel (QuintoAndar)', order: 20, palette: 'alug',
  title: `Yield bruto da unidade (12 × aluguel ÷ preço de venda da MESMA unidade anunciada para alugar e vender); onde n < ${MIN}, estimado pelas medianas (qaqa). O yield sobre o fechamento do ITBI fica no tooltip, nunca na cor.`,
  value: cd => { const v = dval(drow(cd, strat(false).key), 'yield'); return v ? v.v : null; },
  ok: cd => { const v = dval(drow(cd, strat(false).key), 'yield'); return !!(v && v.ok); },
  fmt: v => nf1.format(v) + '%', domain: () => MED.yield.dom(),
  legendLabel: () => `Yield da unidade, % a.a. · ${stratLabel(strat(false))} · QuintoAndar, foto ${FOTO} · pedido`,
  tip: cd => metTip(cd, false)});
R.registerPreset({id: 'aluguel', label: 'Aluguel', order: 50, met: 'yield', cam: ['aluguel'],
  title: `Yield da unidade por distrito; hexágonos (zoom 12–14) e prédios (zoom ≥ 15) com aluguel · QuintoAndar, foto de ${FOTO}`});

/* ════════ VISTA: RADAR ALUGUEL ═══════════════════════════ */
R.registerParam({k: 'amed', get: () => radMed(), set: v => { S.p.alMed = MED[v] ? v : 'yield'; }, def: 'yield', views: ['aluguel']});
R.registerParam({k: 'autil', get: () => S.p.alFu || '*', set: v => { S.p.alFu = FA.includes(v) ? v : '*'; }, def: '*', views: ['aluguel']});
R.registerParam({k: 'amin', get: () => (S.p.alN10 ? '1' : '0'), set: v => { S.p.alN10 = v === '1'; }, def: '0', views: ['aluguel']});
R.registerParam({k: 'abnb', get: () => (S.p.alAb ? '1' : '0'), set: v => { S.p.alAb = v === '1'; }, def: '0', views: ['aluguel']});
R.registerView({id: 'aluguel', label: 'Aluguel', sub: 'aluguel pedido, yield, Airbnb', group: 'radar', order: 40,
  estrato: {tipos: ['apto', 'casa'], dims: ['quartos'], quartos: ['apto', 'casa'], why: 'Aluguel (QuintoAndar): só Apartamento e Casa; quartos nativos do anúncio ("1" = até 1 quarto, inclui studio); área útil nos chips da página'},
  railNote: `Aluguel pedido (QuintoAndar, foto de ${FOTO}), em R$/m² de ÁREA ÚTIL do anúncio: não compare com o R$/m² de área construída do ITBI.`,
  html: `<div class="vhead"><div><span class="eyebrow">Radar · Aluguel e yield</span><h2>Quanto rende alugar aqui?</h2></div>
    <p>Aluguel pedido no QuintoAndar por distrito, hexágono de ~500 m e prédio, sempre em área útil. O yield do mapa é o da própria unidade anunciada para alugar e para vender; o yield sobre o fechamento do ITBI é o segundo número. ${selo()}</p></div>
    <div class="ctrlrow" id="alCtrl" role="group" aria-label="Medida e faixa do aluguel"></div>
    <div class="kpis" id="alKpis"></div>
    <p class="al-kchip" id="alChip"></p>
    <div class="al-grid">
      <div class="card" style="padding:8px 10px 10px"><div id="alMap" class="chart map" role="img" aria-label="Mapa do aluguel: distritos, hexágonos e prédios"></div><div class="legend" id="alLegend"></div></div>
      <div class="card"><h3>Aluguel × venda pedida, por distrito</h3><p class="sub" id="alScSub"></p><div id="alScatter" class="chart" style="height:480px" role="img" aria-label="Dispersão log-log aluguel × venda com diagonais de yield"></div><div class="legend" id="alScLeg"></div></div>
    </div>
    <div class="card"><h3>Ranking dos distritos</h3><p class="sub" id="alRankSub"></p><div class="tablewrap tall" id="alRank" style="max-height:520px"></div></div>
    <div class="two">
      <div class="card"><h3>Curta estadia (Airbnb) × aluguel longo</h3><p class="sub" id="alCurtaSub"></p><div class="kpis" id="alCurtaKpis"></div><div id="alCurta" class="chart" style="height:430px;margin-top:8px"></div><p class="note" id="alCurtaNote"></p></div>
      <div class="card"><h3>A foto no tempo: FipeZAP da cidade</h3><p class="sub" id="alFzSub"></p><h4 class="al-ch">Aluguel, R$/m² por mês</h4><div id="alFz" class="chart" style="height:200px"></div><h4 class="al-ch">Rentabilidade (FipeZAP) e yield, % a.a.</h4><div id="alFzY" class="chart" style="height:190px"></div><div class="al-leg" id="alFzLeg"></div></div>
    </div>
    <div class="card al-notes" id="alNotes"></div>`,
  render: renderAluguel});

let MA = null; const MAS = {fitted: false, cds: [], once: false};
function renderAluguel() {
  // o núcleo ajusta o estrato ao que o tema declara (Apartamento/Casa × Quartos nativos do anúncio)
  if (S.p.alFu && S.p.alFu !== '*' && S.dim === 'quartos' && S.fx !== '*') S.p.alFu = '*';   // o último escolhido vale: quartos (topo) × área útil (chips)
  renderCtrl();
  if (!AL.D) {
    $('alKpis').innerHTML = `<div class="kpi"><span class="l">Aluguel</span><span class="v">${AL.err ? '—' : '…'}</span><span class="d">${AL.err ? 'dados indisponíveis: abra pela URL do serve.py (aluguel/*.json)' : 'carregando…'}</span></div>`;
    if (!AL.err) loadBase().then(() => { if (S.view === 'aluguel') R.render(); }).catch(() => { if (S.view === 'aluguel') R.render(); });
    return;
  }
  R.safe('aluguel · KPIs', renderKpis);
  R.safe('aluguel · mapa', radarMap);
  R.safe('aluguel · dispersão', renderScatter);
  R.safe('aluguel · ranking', renderRank);
  R.safe('aluguel · curta', renderCurta);
  R.safe('aluguel · FipeZAP', renderFz);
  R.safe('aluguel · notas', renderNotes);
  R.renderSections('aluguel', {});
}
function renderCtrl() {
  const med = radMed(), fu = S.p.alFu || '*', cols = R.fxColors('area'), st = strat(true);
  const casaWarn = st.g === 'casa' && S.fx !== '*' && S.dim !== 'quartos';
  $('alCtrl').innerHTML =
    `<span class="lab">Medida</span><div class="seg" id="alMedSeg">${MKEYS.map(k => `<button type="button" data-med="${k}" aria-pressed="${med === k}" title="${esc(MED[k].long)}">${esc(MED[k].label)}</button>`).join('')}</div>` +
    `<span class="lab" title="Área útil do anúncio (≠ área construída do IPTU: razão mediana 1,64, de 1,33 a 1,88 entre prédios)">Área útil</span>` +
    `<div class="fx" id="alFu" role="group" aria-label="Faixa de área útil"><button type="button" data-fu="*" aria-pressed="${fu === '*'}" style="--c:${css('--ink')}"><i></i>Todas</button>` +
    FA.map((f, i) => `<button type="button" data-fu="${esc(f)}" aria-pressed="${fu === f}" style="--c:${cols[i]}" title="${esc(f)} m² de área útil do anúncio (a cor segue a posição da faixa; a régua é outra que a da área construída do ITBI)"><i></i>${esc(f)} m²</button>`).join('') + `</div>` +
    `<label class="chk" title="Esconde distritos, hexágonos e linhas com menos de ${MIN} anúncios (o padrão é mostrá-los em cinza)"><input type="checkbox" id="alN10"${S.p.alN10 ? ' checked' : ''}> só n ≥ ${MIN}</label>` +
    `<label class="chk" title="Inside Airbnb, 14/06/2026 (CC BY 4.0): só por hexágono"><input type="checkbox" id="alAb"${S.p.alAb ? ' checked' : ''}> Airbnb no mapa</label>` +
    `<span class="al-hint">Tipo e quartos: seletor do topo (“1” = até 1 quarto, inclui studio) · <b>${esc(stratLabel(st))}</b></span>` +
    (casaWarn ? `<span class="al-warn">As faixas do topo são de área construída do ITBI e não valem para o aluguel: use a área útil acima.</span>` : '');
}
$('alCtrl').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.med) { S.p.alMed = b.dataset.med; R.render(); return; }
  if (b.dataset.fu) { S.p.alFu = b.dataset.fu; if (b.dataset.fu !== '*' && S.dim === 'quartos') S.fx = '*'; R.render(); }
});
$('alCtrl').addEventListener('change', e => {
  if (e.target.id === 'alN10') { S.p.alN10 = e.target.checked; R.render(); }
  if (e.target.id === 'alAb') { S.p.alAb = e.target.checked; R.render(); }
});
function renderKpis() {
  const st = strat(true), r = drow('SP', st.key), rt = drow('SP', st.tot);
  if (!st.g || !r) { $('alKpis').innerHTML = kpi('Aluguel', '—', 'sem anúncios do estrato'); $('alChip').innerHTML = ''; return; }
  const y = dval(r, 'yield');
  $('alKpis').innerHTML = [
    kpi(`Aluguel R$/m² útil/mês`, fAm2(r.p50), `${r.lo != null ? `IC95% ${nf1.format(r.lo)}–${nf1.format(r.hi)} · ` : ''}IQR ${nf1.format(r.p25)}–${nf1.format(r.p75)} · n=${fN(r.n)}`),
    kpi('Yield da unidade', y && y.v != null ? fY(y.v) : '—', !y || y.v == null ? 'sem par aluguel + venda' : !y.fb && r.y25 != null ? `IQR ${nf1.format(r.y25)}–${nf1.format(r.y75)} · n=${fN(r.yn)} unid.` : 'estimado pelas medianas (qaqa)'),
    kpi('≈ Yield no fechamento ITBI', r.yi != null ? fY(r.yi) : '—', r.yi != null ? `IQR ${nf1.format(r.yi25)}–${nf1.format(r.yi75)} · ${fN(r.yin)} prédios` : st.dim === 'area_util' ? 'não calculado por área útil' : st.g === 'casa' ? 'só apartamento' : '—'),
    kpi('Aluguel/mês', fRs(r.al), `IQR ${fRs(r.al25)} – ${fRs(r.al75)}`),
    kpi('Custo de morar', fRs(r.cm), r.peso != null ? `aluguel + cond. + IPTU · cond.+IPTU ${nf0.format(r.peso)}%` : 'aluguel + cond. + IPTU'),
    kpi('Anúncios de aluguel', fN(r.nb), rt && rt.of != null ? `${nf1.format(rt.of)} por 1.000 ${st.g === 'apto' ? 'aptos' : 'casas'} do IPTU` : ''),
  ].join('');
  const razao = AL.meta && AL.meta.itbi ? AL.meta.itbi.razao_itbi_unid : null;
  $('alChip').innerHTML = y && y.v != null ? `Cidade · ${esc(stratLabel(st))}: <b>${fY(y.v)}</b> sobre o preço pedido${!y.fb && r.y25 != null ? ` [${nf1.format(r.y25)}–${nf1.format(r.y75)}]` : ' (estimado, qaqa)'} (n = ${fN(r.yn)} unid.)` +
    (r.yi != null ? ` · <b>≈ ${fY(r.yi)}</b> sobre o fechamento do ITBI (${fN(r.yin)} prédios; nos mesmos prédios, ${razao ? nf2.format(razao) : '1,24'}× o pedido)` : '') + ` ${selo()}` : '';
}

/* mapa do radar: distrito (até o zoom 11) → hexágono (12–14) → prédio (≥ 15), uma escala só */
function radarMap() {
  if (!MA) { MA = R.createBaseMap($('alMap'), {layers: {predios: 'off', lotes: 'off'}, onStyle: () => radarApply()}); if (MA) wireRadar(); }
  radarApply();
}
function radarApply() {
  const H = MA; if (!H || !H.ready || !AL.D) return;
  const map = H.map, st = strat(true), med = radMed(), only = !!S.p.alN10;
  ensureLayers(map, PR, R.firstSymbol(map), true);
  const gray = css('--gray-cell'), stops = R.PALS.alug();
  map.getSource(PR + 'dist').setData({type: 'FeatureCollection', features: R.DF.map(f => {
    const cd = f.properties.cd, r = st.g ? drow(cd, st.key) : null, v = st.g ? dval(r, med, drow(cd, st.tot)) : null, ok = !!(v && v.ok && v.v != null);
    const nd = !r || !(r.nb || r.n) ? 1 : 0;   // sem nenhum anúncio de aluguel do estrato
    return {type: 'Feature', geometry: f.geometry, properties: {cd, nd, fc: ok ? colOf(med, st.g, v.v, stops) : gray, op: ok ? 0.8 : nd || only ? 0 : 0.7}};
  })});
  const miss = [];
  if (!AL.hex) miss.push(loadHex());
  if (S.p.alAb && !AL.curta) miss.push(loadCurta());
  const cds = map.getZoom() >= 14.5 ? cdsInView(map) : [];
  cds.forEach(cd => { if (!AL.pred[cd]) miss.push(loadPred(cd)); });
  if (miss.length) Promise.allSettled(miss).then(() => { if (S.view === 'aluguel') radarApply(); });
  map.getSource(PR + 'hex').setData(hexFC(med, st, only));
  map.getSource(PR + 'pred').setData(predFC(med, st, cds));
  map.getSource(PR + 'curta').setData(S.p.alAb ? curtaFC() : R.EMPTY_FC);
  map.setLayerZoomRange(PR + 'hex-fill', 12, 15); map.setLayerZoomRange(PR + 'hex-line', 12, 15);
  [PR + 'curta-line', PR + 'curta-hit'].forEach(id => R.visL(map, id, !!S.p.alAb));
  if (!MAS.fitted) { MAS.fitted = true; H.fit({bounds: [[-46.83, -23.80], [-46.36, -23.36]], padding: 8, maxZoom: 12, pitch: 0, bearing: 0}); }
  if (S.p.alFocus && R.DIST[S.p.alFocus]) { const b = R.DIST[S.p.alFocus].bb; H.fit({bounds: [[b[0], b[1]], [b[2], b[3]]], padding: 24, maxZoom: 13.5, duration: 0}); S.p.alFocus = null; }
  $('alLegend').innerHTML = scaleHtml(med, st) + selo() +
    `<span class="it"><i class="dot" style="border-radius:2px;background:var(--gray-cell)"></i>n abaixo do mínimo (cinza)</span>` +
    `<span class="it"><i class="dot hatch" style="border-radius:2px;box-shadow:inset 0 0 0 1px var(--border-strong)"></i>sem anúncio do estrato (não é aluguel zero; sem hexágono idem)</span>` +
    `<span class="it muted">distritos até o zoom 11 · hexágonos 12–14 · prédios a partir do 15</span>` + symbolsLegend(med) + (S.p.alAb ? curtaLegend() : '') +
    (med === 'oferta' && st.dim !== 'todos' ? `<span class="it muted">oferta: todas as faixas do grupo (o IPTU não tem quartos nem área útil)</span>` : '');
}
function wireRadar() {
  const map = MA.map;
  R.wireMap(MA, {
    layers: () => [PR + 'pred-c', PR + 'hex-fill'].concat(S.p.alAb ? [PR + 'curta-hit'] : []),
    tip: f => layerTip(f, 'radar'),
    click: f => layerClick(f, MA),
    hoverFallback: e => { if (map.getZoom() >= 12) return null; const t = MA.hit([PR + 'dist-fill'], e.point)[0]; return t ? metTip(t.properties.cd, true) : null; },
    clickFallback: e => { if (map.getZoom() >= 12) return; const t = MA.hit([PR + 'dist-fill'], e.point)[0]; if (t) R.openDist(t.properties.cd); },
  });
  map.on('moveend', R.rafThrottle(() => { if (S.view === 'aluguel') radarApply(); }));
}

/* aluguel × venda (log-log) com diagonais iso-yield: posição num eixo comum > cor (Cleveland e McGill) */
const ZONA = {Centro: 0, Leste: 1, Norte: 2, Oeste: 3, Sul: 4};
const zonaCol = z => [css('--ink-2'), '#3f80d2', '#8d6bd1', '#e0a100', '#eb8a34'][ZONA[z] ?? 0];
function renderScatter() {
  const c = R.chart('alScatter'); if (!c) return;
  const st = strat(true);
  const pts = R.DCODES.map(cd => { const r = drow(cd, st.key); return r && r.p50 != null && r.v != null ? {cd, r, ok: r.n >= MIN && r.vn >= MIN} : null; }).filter(Boolean);
  const good = pts.filter(p => p.ok), weak = S.p.alN10 ? [] : pts.filter(p => !p.ok);
  const all = good.concat(weak);
  $('alScSub').textContent = `${stratLabel(st)} · x = venda pedida, y = aluguel pedido, os dois em R$/m² de área útil do anúncio (escala log). As diagonais são o yield bruto implícito (12 × aluguel ÷ venda). Tamanho = nº de aluguéis; cor = zona. Clique abre o distrito.`;
  if (!all.length) { c.clear(); return; }
  const xs = all.map(p => p.r.v), ys = all.map(p => p.r.p50);
  const x0 = Math.min(...xs) * 0.85, x1 = Math.max(...xs) * 1.15, y0 = Math.min(...ys) * 0.85, y1 = Math.max(...ys) * 1.18;
  const TX = (x1 / x0 > 6 ? LOGXS : LOGX).filter(v => v >= x0 && v <= x1);
  const iso = [4, 5, 6, 7, 8].map(Y => {
    const a = Math.max(x0, y0 * 1200 / Y), b = Math.min(x1, y1 * 1200 / Y); if (a >= b) return null;
    return {name: `${Y}%`, type: 'line', silent: true, symbol: 'none', z: 1, data: [[a, a * Y / 1200], [b, b * Y / 1200]], lineStyle: {color: css('--axis'), type: 'dashed', width: 1},
      endLabel: {show: true, formatter: `${Y}%`, color: css('--muted'), fontSize: 10, distance: 3}};
  }).filter(Boolean);
  const size = n => clamp(6 + Math.sqrt(n) * 0.75, 7, 34);
  const sp = drow('SP', st.key);
  const ttl = p => { const r = p.data && p.data.r; if (!r) return ''; const cd = p.data.cd, y = dval(r, 'yield');
    return tip(R.dname(cd), [['Aluguel R$/m² útil (IQR)', `${fAm2(r.p50)} (${nf1.format(r.p25)}–${nf1.format(r.p75)}) · n=${fN(r.n)}`],
      ['Venda pedida R$/m² útil', `${fRs(r.v)} · n=${fN(r.vn)}`], ['Yield implícito (medianas)', fY(1200 * r.p50 / r.v)],
      ['Yield da unidade', y && y.v != null ? `${fY(y.v)}${y.fb ? ' (qaqa)' : ''} · n=${fN(r.yn)}` : '—'], ['≈ Yield no fechamento ITBI', r.yi != null ? `${fY(r.yi)} · ${fN(r.yin)} prédios` : '—']],
      `${stratLabel(st)} · foto ${FOTO} · pedido · clique para abrir`); };
  c.setOption(Object.assign(R.base(), {
    grid: {left: 58, right: 64, top: 14, bottom: 46},
    xAxis: R.ax({type: 'log', min: x0, max: x1, name: 'venda pedida, R$/m² útil (log)', nameLocation: 'middle', nameGap: 28, splitLine: {show: false},
      axisTick: {show: true, customValues: TX, lineStyle: {color: css('--axis')}},
      axisLabel: {color: css('--muted'), fontSize: 10.5, customValues: TX, formatter: v => nf0.format(v)}}),
    yAxis: R.ax({type: 'log', min: y0, max: y1, name: 'aluguel, R$/m² útil/mês (log)', nameLocation: 'middle', nameGap: 40, splitLine: {show: false},
      axisTick: {show: true, customValues: LOGY.filter(v => v >= y0 && v <= y1), lineStyle: {color: css('--axis')}},
      axisLabel: {color: css('--muted'), fontSize: 10.5, customValues: LOGY.filter(v => v >= y0 && v <= y1), formatter: v => nf0.format(v)}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: ttl}),
    series: iso.concat([
      {name: 'distritos', type: 'scatter', z: 3, data: good.map(p => ({value: [p.r.v, p.r.p50], cd: p.cd, r: p.r, symbolSize: size(p.r.n),
        itemStyle: {color: zonaCol(R.DIST[p.cd].r5), opacity: 0.85, borderColor: css('--surface'), borderWidth: 1},
        label: {show: true, formatter: R.DIST[p.cd].nome, position: 'right', fontSize: 10, color: css('--ink-2')}})),
        labelLayout: {hideOverlap: true},
        markPoint: sp && sp.v ? {symbol: 'diamond', symbolSize: 13, silent: true, data: [{coord: [sp.v, sp.p50], name: 'cidade'}],
          itemStyle: {color: 'transparent', borderColor: css('--ink'), borderWidth: 1.6}, label: {show: false}} : undefined},
      {name: `n < ${MIN}`, type: 'scatter', z: 2, data: weak.map(p => ({value: [p.r.v, p.r.p50], cd: p.cd, r: p.r, symbolSize: 6})), itemStyle: {color: 'transparent', borderColor: css('--muted'), borderWidth: 1}},
    ]),
  }), true);
  c.off('click'); c.on('click', p => { if (p.data && p.data.cd) R.openDist(p.data.cd); });
  $('alScLeg').innerHTML = Object.keys(ZONA).map(z => `<span class="it"><i class="dot" style="background:${zonaCol(z)}"></i>${z}</span>`).join('') +
    `<span class="it"><i class="al-dia"></i>cidade</span><span class="it"><i class="dot" style="box-shadow:inset 0 0 0 1px var(--muted)"></i>n &lt; ${MIN} (aluguel ou venda)</span>` +
    `<span class="it muted">${good.length} distritos · diagonais = yield bruto implícito, 4–8% a.a.</span>${selo()}`;
}
function rbar(a, m, b, lo, hi, log) {
  if (m == null) return '';
  const L = v => clamp(log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo), 0, 1) * 100;
  return `<span class="al-rb"><span class="tr"></span>${a != null && b != null ? `<span class="iq" style="left:${L(a)}%;width:${Math.max(2, L(b) - L(a))}%"></span>` : ''}<span class="md" style="left:${L(m)}%"></span></span>`;
}
function renderRank() {
  const st = strat(true), med = radMed();
  const rows = R.DCODES.map(cd => { const r = drow(cd, st.key); return r && r.n ? {cd, name: R.dname(cd), r, rt: drow(cd, st.tot), y: dval(r, 'yield')} : null; })
    .filter(Boolean).filter(x => !S.p.alN10 || x.r.n >= MIN);
  const [alo, ahi] = MED.alug_m2.dom(st.g);
  $('alRankSub').textContent = `${stratLabel(st)} · ${rows.length} distritos com anúncio. Cinza = n < ${MIN}. Yield da unidade com IQR; “≈ no fechamento” é o segundo número (aluguel pedido ÷ valor ITBI registrado no mesmo prédio). Clique para abrir o distrito.`;
  const g = x => x.r.n >= MIN;
  const keyOf = {alug_m2: 'p50', aluguel: 'al', custo: 'cm', yield: 'y', oferta: 'of'}[med];
  R.table($('alRank'), 'alrank', [
    {k: 'name', label: 'Distrito', f: x => `<button class="linkbtn" type="button">${esc(x.name)}</button>`},
    {k: 'y', label: 'Yield da unid. [IQR]', n: 1, sv: x => x.y ? x.y.v : null, f: x => !x.y || x.y.v == null ? '<span class="gray">—</span>' : x.y.fb ? `<span class="al-fb" title="n da unidade < ${MIN}: estimado pelas medianas (qaqa)">${fY(x.y.v)} qaqa</span>` :
      `<span${x.r.yn >= MIN ? '' : ' class="gray"'}>${fY(x.y.v)}</span> <span class="ci">[${nf1.format(x.r.y25)}–${nf1.format(x.r.y75)}]</span>${R.nBadge(x.r.yn)}`},
    {k: 'yi', label: '≈ no fechamento', n: 1, title: 'Aluguel pedido ÷ valor registrado no ITBI (jan/2025–ago/2026), mesmo prédio e tipologia: segundo número, nunca cor', sv: x => x.r.yi,
      f: x => x.r.yi != null ? `${fY(x.r.yi)}${R.nBadge(x.r.yin)}` : '<span class="gray">—</span>'},
    {k: 'p50', label: 'Aluguel R$/m² (IQR)', n: 1, sv: x => x.r.p50, f: x => `<span${g(x) ? '' : ' class="gray"'}>${rbar(x.r.p25, x.r.p50, x.r.p75, alo, ahi, true)}${nf1.format(x.r.p50)}</span>${R.nBadge(x.r.n)}`},
    {k: 'al', label: 'Aluguel/mês', n: 1, sv: x => x.r.al, f: x => fRs(x.r.al)},
    {k: 'cm', label: 'Custo de morar', n: 1, sv: x => x.r.cm, f: x => fRs(x.r.cm)},
    {k: 'v', label: 'Venda R$/m²', n: 1, title: 'Venda pedida, R$/m² útil (QuintoAndar)', sv: x => x.r.v, f: x => x.r.v != null ? `${fRs(x.r.v)}${R.nBadge(x.r.vn)}` : '—'},
    {k: 'of', label: 'Oferta /1.000', n: 1, title: 'Anúncios de aluguel por 1.000 unidades do IPTU (grupo): presença da plataforma, não vacância', sv: x => x.rt ? x.rt.of : null, f: x => x.rt && x.rt.of != null ? nf1.format(x.rt.of) : '—'},
  ], rows, {sort: {k: keyOf === 'of' ? 'of' : keyOf, d: 'desc'}, onRow: x => R.openDist(x.cd), rowAttr: x => g(x) ? '' : 'style="color:var(--muted)"'});
}
function renderCurta() {
  const el = $('alCurta');
  if (!AL.curta) { $('alCurtaSub').textContent = 'Carregando Inside Airbnb…'; loadCurta().then(() => { if (S.view === 'aluguel') R.safe('aluguel · curta', renderCurta); }).catch(() => { $('alCurtaSub').textContent = 'Inside Airbnb indisponível (abra pelo serve.py).'; }); return; }
  const C = AL.curta, ct = C.city, st = strat(true);
  const fq = st.dim === 'quartos' ? st.fx : '≤1';
  $('alCurtaSub').innerHTML = `Imóvel inteiro, estadia curta. Noites por mês que a diária mediana precisa para igualar o aluguel longo mediano (QuintoAndar) do mesmo distrito e quartos: <b>${esc(QLB[fq])}</b>${st.dim === 'quartos' ? '' : ' (a tipologia dominante do Airbnb; escolha outra no topo)'}.`;
  $('alCurtaKpis').innerHTML = [
    kpi('Diária mediana', fRs(ct.di), `IQR ${fRs(ct.d25)}–${fRs(ct.d75)} · n=${fN(ct.ni)}`),
    kpi('Noites/mês p/ empatar', nf1.format(ct.ne[1]), `IQR ${nf1.format(ct.ne[0])}–${nf1.format(ct.ne[2])} · ${ct.celulas} células`),
    kpi('Receita est. ÷ aluguel longo', nf2.format(ct.csl[1]) + '×', `IQR ${nf2.format(ct.csl[0])}–${nf2.format(ct.csl[2])} · piso`),
    kpi('Anúncios Airbnb', fN(ct.n), `${ct.mu}% de operadores com 5+`),
  ].join('');
  const rows = Object.entries(C.dist).map(([cd, d]) => { const q = d.q && d.q[fq]; return q && q[6] != null ? {cd, n: q[0], di: q[1], rm: q[2], oc: q[3], al: q[4], csl: q[5], ne: q[6], nAll: d.n} : null; })
    .filter(Boolean).sort((a, b) => b.nAll - a.nAll).slice(0, 26).sort((a, b) => a.ne - b.ne);
  const c = R.chart('alCurta'); if (!c) return;
  if (!rows.length) { c.clear(); $('alCurtaNote').textContent = `Sem células com n ≥ 10 dos dois lados para ${QLB[fq]}.`; return; }
  const V = R.PALS.alug();
  c.setOption(Object.assign(R.base(), {
    grid: {left: 128, right: 30, top: 20, bottom: 34},
    xAxis: R.ax({type: 'value', min: 0, max: v => Math.max(12, Math.ceil((v.max + 0.5) / 3) * 3), interval: 3, name: 'noites por mês para igualar o aluguel longo', nameLocation: 'middle', nameGap: 22, axisLabel: {color: css('--muted'), fontSize: 10}}),
    yAxis: R.ax({type: 'category', data: rows.map(r => R.dname(r.cd)), inverse: true, splitLine: {show: false}, axisLabel: {color: css('--ink-2'), fontSize: 10.5}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { const r = rows[p.dataIndex]; if (!r) return '';
      return tip(`${R.dname(r.cd)} · ${QLB[fq]}`, [['Noites/mês para empatar', nf1.format(r.ne)], ['Diária mediana (Airbnb)', fRs(r.di)], ['Aluguel longo mediano (QuintoAndar)', fRs(r.al)],
        ['Receita estimada/mês (piso)', fRs(r.rm)], ['Ocupação estimada', fN(r.oc) + ' noites/ano'], ['Receita ÷ aluguel longo', nf2.format(r.csl) + '×'], ['n Airbnb (célula)', fN(r.n)]],
        'Inside Airbnb 14/06/2026 (CC BY 4.0) · QuintoAndar foto 20/06/2026 · antes dos custos de operar'); }}),
    series: [
      {type: 'bar', data: rows.map(r => r.ne), barWidth: 2, itemStyle: {color: css('--axis')}, silent: true},
      {type: 'scatter', data: rows.map(r => r.ne), symbolSize: 9, itemStyle: {color: V[3], borderColor: css('--surface'), borderWidth: 1},
        markLine: {silent: true, symbol: 'none', lineStyle: {color: css('--ink'), type: 'dashed', width: 1}, label: {position: 'start', color: css('--ink-2'), fontSize: 10, formatter: p => p.name},
          data: [{xAxis: ct.ne[1], name: `cidade ${nf1.format(ct.ne[1])}`}]}},
    ],
  }), true);
  $('alCurtaNote').innerHTML = `Os ${rows.length} distritos com mais anúncios Airbnb e n ≥ 10 dos dois lados. A receita estimada pelo Inside Airbnb usa avaliações e é um <b>piso</b> (ocupação mediana ${fN(ct.oc)} noites/ano); a diária nunca vira aluguel mensal e a conta vem antes dos custos de operar (mobília, limpeza, vacância, taxas). ` +
    `Ponto deslocado até ~150 m pela Airbnb (${nf0.format(ct.bi)}% a menos de 150 m de uma divisa): só hexágono e distrito. Fonte: Inside Airbnb, 14/06/2026, <span class="lic">CC BY 4.0</span>; dados brutos não republicados.`;
}
function renderFz() {
  if (!AL.fz) { $('alFzSub').textContent = 'Carregando FipeZAP…'; loadFz().then(() => { if (S.view === 'aluguel') R.safe('aluguel · FipeZAP', renderFz); }).catch(() => { $('alFzSub').textContent = 'FipeZAP indisponível.'; }); return; }
  const F = AL.fz, st = strat(true), r = drow('SP', st.key);
  const ek = st.dim === 'quartos' ? {'≤1': '1D', '2': '2D', '3': '3D', '4+': '4D'}[st.fx] : 'T';
  const T = F.t, iQ = T.indexOf('2026-06'), iI = T.indexOf('2025-10');
  const loc = F.s['loc_' + ek] || [], ren = F.s['rent_' + ek] || [];
  const eLab = ek === 'T' ? 'total' : ek.replace('D', ' dorm.');
  $('alFzSub').innerHTML = `Apartamentos, cidade de São Paulo, ${eLab} (FipeZAP, anúncios, média móvel de 3 meses). A foto do QuintoAndar é um ponto só (◇); a série dá o contexto no tempo${st.g === 'casa' ? ' — o FipeZAP cobre só apartamentos' : ''}.`;
  const xa = (show) => R.ax({type: 'category', data: T, boundaryGap: false, axisLabel: {show, color: css('--muted'), fontSize: 10, interval: i => /-01$/.test(T[i]) && (+T[i].slice(0, 4)) % 3 === 2, formatter: v => v.slice(0, 4)}});
  const qaPt = (val, lab) => val == null || iQ < 0 ? [] : [{type: 'scatter', data: [[iQ, val]], symbol: 'diamond', symbolSize: 12, z: 5,
    itemStyle: {color: 'transparent', borderColor: css('--ink'), borderWidth: 1.8}, label: {show: true, formatter: lab, position: 'left', color: css('--ink'), fontSize: 10.5}}];
  const c1 = R.chart('alFz'), c2 = R.chart('alFzY'); if (!c1 || !c2) return;
  const tt = (title, unit) => Object.assign(R.base().tooltip, {trigger: 'axis', formatter: ps => { const i = ps[0].dataIndex; return tip(`${T[i]} · ${title}`, ps.filter(p => p.value != null).map(p => [p.seriesName, Array.isArray(p.value) ? unit(p.value[1]) : unit(p.value)])); }});
  c1.setOption(Object.assign(R.base(), {grid: {left: 46, right: 22, top: 10, bottom: 8},
    xAxis: xa(false), yAxis: R.ax({type: 'value', scale: true, axisLabel: {color: css('--muted'), fontSize: 10}}),
    tooltip: tt('aluguel R$/m²', v => 'R$ ' + nf1.format(v)),
    series: [{name: `FipeZAP (${eLab})`, type: 'line', data: loc, symbol: 'none', lineStyle: {color: css('--ink-2'), width: 1.6, type: 'dashed'}, itemStyle: {color: css('--ink-2')}}]
      .concat(qaPt(r && r.p50, r ? `QuintoAndar ${nf1.format(r.p50)}` : '').map(s => Object.assign(s, {name: 'QuintoAndar (foto)'})))}), true);
  const yI = r && r.yi != null && iI >= 0 ? [{name: '≈ no fechamento ITBI', type: 'scatter', data: [[iI, r.yi]], symbol: 'circle', symbolSize: 8, z: 5, itemStyle: {color: css('--ink')},
    label: {show: true, formatter: `fechamento ${nf1.format(r.yi)}%`, position: 'left', color: css('--ink-2'), fontSize: 10}}] : [];
  const y = r ? dval(r, 'yield') : null;
  c2.setOption(Object.assign(R.base(), {grid: {left: 46, right: 22, top: 10, bottom: 24},
    xAxis: xa(true), yAxis: R.ax({type: 'value', scale: true, axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf0.format(v) + '%'}}),
    tooltip: tt('yield % a.a.', v => nf2.format(v) + '%'),
    series: [{name: `FipeZAP rentabilidade (${eLab})`, type: 'line', data: ren, symbol: 'none', lineStyle: {color: css('--ink-2'), width: 1.6, type: 'dashed'}, itemStyle: {color: css('--ink-2')}}]
      .concat(qaPt(y && y.v, y && y.v != null ? `unidade ${nf1.format(y.v)}%` : '').map(s => Object.assign(s, {name: 'Yield da unidade (foto)'}))).concat(yI)}), true);
  const last = T.length - 1;
  $('alFzLeg').innerHTML = `<span class="it"><i class="lk" style="background:var(--ink-2);height:2px;width:16px;display:inline-block"></i>FipeZAP (pedido, tracejado)</span><span class="it"><i class="al-dia"></i>QuintoAndar, jun/2026 (pedido)</span>` +
    `<span class="it"><i class="al-cir"></i>≈ yield no fechamento ITBI (mediana dos fechamentos out/2025)</span>` +
    `<span class="it muted">FipeZAP ${esc(T[last].split('-').reverse().join('/'))}: aluguel ${loc[last] != null ? 'R$ ' + nf1.format(loc[last]) : '—'}/m² (${F.s['loc12_' + ek] ? fPct1(F.s['loc12_' + ek][last]) : '—'} em 12 m); venda ${F.s['ven12_' + ek] ? fPct1(F.s['ven12_' + ek][last]) : '—'} em 12 m · Fipe, atualizado em 21/09/2026</span>`;
}
function renderNotes() {
  const cob = AL.meta ? AL.meta.pad : null;
  const padTxt = cob ? cob.map(p => `${p[0]} ${nf1.format(p[4])}`).join(' · ') : '';
  $('alNotes').innerHTML = `<h3>Como ler (e o que não ler) ${selo()}</h3><ol>
    <li><b>Pedido ≠ fechado.</b> Na venda, o pedido fica ~23% acima do fechamento do ITBI (+23,4%, IQR 10,8–44,5, em 6.208 prédios). No aluguel o desconto não é observável, e uma foto do estoque retém justamente o anúncio caro que não aluga.</li>
    <li><b>Foto única de ${FOTO}.</b> Sem série, sem variação, sem tendência: o aluguel não entra no gráfico temporal do ITBI. O FipeZAP dá o contexto no tempo.</li>
    <li><b>Área útil ≠ área construída.</b> Construída ÷ útil tem mediana 1,64 (IQR 1,33–1,88 entre prédios). Nunca divida o R$/m² do aluguel pelo R$/m² do ITBI: o yield no fechamento compara valor por unidade, no mesmo prédio e tipologia.</li>
    <li><b>Três yields, nunca misturados.</b> Da unidade (cor): 12 × aluguel ÷ venda da mesma unidade, sem viés de seleção (1,010 no aluguel, 1,001 na venda). Qaqa (medianas): só onde n &lt; ${MIN}, marcado. No fechamento (2º número): ITBI jan/2025–ago/2026, mediana 15/10/2025 (~2,6% alto pela defasagem), valor declarado, prédio novo (ACC ≥ 2023) sai ~1,32×; passa de 14% em 406 prédios.</li>
    <li><b>Viés da plataforma.</b> Anúncios de aluguel por 1.000 aptos, por padrão do IPTU: ${esc(padTxt)}. Itaim Bibi 31, Jardim Ângela 0,7, Parelheiros e Marsilac 0. Entre distritos, a oferta por 1.000 mede presença da plataforma e liquidez (ρ = 0,90 com o giro do ITBI), não vacância.</li>
    <li><b>Mobiliado e temporada não se distinguem</b> (o campo não existe): inflam a faixa ≤35 m², que aluga a ~1,8× o R$/m² da faixa 50–70. Condomínio + IPTU = 0 é “não informado” e fica fora do custo de morar.</li>
    <li><b>Termos do QuintoAndar (§5).</b> Base congelada para pesquisa interna, sem re-coleta; aqui só aparecem agregados (distrito, hexágono, prédio com n). Airbnb: Inside Airbnb, CC BY 4.0, só por hexágono e distrito.</li></ol>`;
}

/* ════════ SEÇÃO NO PRÉDIO ═════════════════════════════════ */
R.registerSection('predio', {id: 'aluguel', title: 'Aluguel no prédio', order: 20, render: (el, ctx) => renderPredSec(el, ctx)});
function renderPredSec(el, ctx) {
  const l = ctx.lot, cd = ctx.cd;
  if (!AL.D || !AL.pred[cd]) {
    el.innerHTML = `<div class="loading">Carregando anúncios de aluguel…</div>`;
    Promise.all([loadBase(), loadPred(cd)]).then(() => { if (S.view === 'predio' && S.lot === l.id) renderPredSec(el, ctx); })
      .catch(() => { el.innerHTML = '<p class="al-empty">Aluguel indisponível: abra pela URL do serve.py.</p>'; });
    return;
  }
  const p = AL.pred[cd].find(x => x.lot === l.id);
  const g = (p && p.gr) || grupo() || 'apto', dr = drow(cd, `${g}|todos|todos`);
  const ref = dr ? `Referência do distrito (${g === 'apto' ? 'apartamento' : 'casa'}, todas as faixas): <b>${fAm2(dr.p50)}</b> (IQR ${nf1.format(dr.p25)}–${nf1.format(dr.p75)}, n = ${fN(dr.n)}) · yield da unidade <b>${fY(dval(dr, 'yield') && dval(dr, 'yield').v)}</b>.` : '';
  if (!p) {
    el.innerHTML = `<p class="al-empty">Nenhum anúncio de aluguel neste lote na foto de ${FOTO} (QuintoAndar)${l.qa && l.qa.ns ? `; há ${fN(l.qa.ns)} de venda (ver Tipologias)` : ''}. ${selo()}</p><p class="note">${ref}</p>`;
    return;
  }
  const s = p.s, q = p.q;
  const dq = fx => drow(cd, `${g}|quartos|${fx}`);
  const rowsQ = QS.filter(fx => q[fx]).map(fx => [fx, q[fx]]).concat(q['*'] ? [['*', q['*']]] : []);
  const cell = (v, fmt, n) => v == null ? '<span class="gray">—</span>' : fmt(v) + (n != null ? `<small>n=${fN(n)}</small>` : '');
  const tr = ([fx, a]) => {
    const tot = fx === '*', d = tot ? dr : dq(fx);
    const vsD = !tot && a[3] != null && d && d.p50 && d.n >= MIN ? (a[3] / d.p50 - 1) * 100 : null;   // total mistura tipologias: sem comparação
    const yi = tot ? s.yi : a[11], iv = tot ? s.iv : a[13], ni = tot ? s.in : a[12];
    return `<tr${tot ? ' class="tot"' : ''}><td class="q">${tot ? 'Todos' : esc(QLB[fx])}</td><td class="n">${a[0] ? `${fN(a[1])}<small>de ${fN(a[0])}</small>` : '<span class="gray" title="só anúncios de venda nesta tipologia">—</span>'}</td>` +
      `<td class="n">${cell(a[2], fRs)}</td><td class="n">${cell(a[3], v => nf1.format(v))}</td><td class="n">${vsD == null ? '<span class="gray">—</span>' : fPctS(vsD)}</td>` +
      `<td class="n">${cell(a[4], v => nf0.format(v) + ' m²')}</td><td class="n">${cell(a[5], fRs)}</td>` +
      `<td class="n">${a[7] != null ? `${fK(a[7])}<small>${a[8] != null ? nf0.format(a[8]) + '/m² · ' : ''}n=${fN(a[6])}</small>` : '<span class="gray">—</span>'}</td>` +
      `<td class="n">${iv != null ? `${fK(iv)}<small>n=${fN(ni)}</small>` : '<span class="gray">—</span>'}</td>` +
      `<td class="n">${a[9] != null ? `<b>${fY(a[9])}</b><small>n=${fN(a[10])}</small>` : '<span class="gray">—</span>'}</td>` +
      `<td class="n">${yi != null ? '≈ ' + fY(yi) : '<span class="gray">—</span>'}</td></tr>`;
  };
  const facts = [];
  if (s.pv != null) facts.push(`<span>Prêmio sobre a vizinhança: <b>${fPctS(s.pv)}</b> <span class="muted">(R$/m² contra anúncios do mesmo grupo e quartos num raio de 500 m, fora o próprio prédio; ${fN(s.nv5)} vizinhos)</span></span>`);
  if (s.of != null) facts.push(`<span>Oferta: <b>${nf1.format(s.of)}</b> anúncios de aluguel por 1.000 unidades <span class="muted">(${fN(s.nu)} unid. no IPTU; mediana dos condomínios 0, p90 45,5)</span></span>`);
  if (p.conc) facts.push(`<span class="flag">Oferta concentrada: ≥ 50% das unidades anunciadas para alugar (prédio de renda ou entrega recente em massa)</span>`);
  if (p.rzok && s.rz != null) facts.push(`<span>Construída ÷ útil neste prédio: <b>${nf2.format(s.rz)}</b>${s.iru != null ? ` · ITBI ≈ <b>${fRs(s.iru)}</b>/m² útil (estimado)` : ''} <span class="muted">(cidade 1,64)</span></span>`);
  if (s.sp != null) facts.push(`<span>Venda pedida × fechamento ITBI: <b>${fPctS(s.sp)}</b> <span class="muted">(tipologia única; cidade +23,4%)</span></span>`);
  if (p.facc === '2023+') facts.push(`<span class="flag">Prédio novo (ACC ≥ 2023): o yield no fechamento tende a sair alto (guia com valor de contrato na planta, ~1,32×)</span>`);
  el.innerHTML = `<div class="al-dhead"><span class="sub">${fN(p.nb)} anúncio(s) de aluguel e ${fN(p.nv)} de venda ${p.g === 'c' ? 'no condomínio' : 'no lote'}${s.acc ? ` · ACC ${s.acc}` : ''}${p.pad ? ' · ' + esc(p.pad) : ''}</span>${selo()}</div>` +
    `<div class="tablewrap"><table class="t al-tb"><thead><tr><th>Quartos</th><th class="n" title="anúncios no preço de todos os anúncios de aluguel">Anúncios</th><th class="n">Aluguel/mês</th><th class="n">R$/m² útil</th><th class="n" title="R$/m² contra a mediana do distrito, mesmo grupo e quartos">vs distrito</th><th class="n">Área útil</th><th class="n" title="aluguel + condomínio + IPTU (sem a taxa do QuintoAndar, ~3,9% do aluguel)">Custo de morar</th><th class="n">Venda pedida</th><th class="n" title="valor mediano registrado no ITBI, jan/2025–ago/2026, mesma tipologia (quartos estimados no prédio)">Fechamento ITBI</th><th class="n" title="12 × aluguel ÷ preço de venda da mesma unidade (dupla oferta)">Yield da unid.</th><th class="n" title="aluguel pedido ÷ fechamento ITBI no mesmo prédio e tipologia: segundo número">≈ no fechamento</th></tr></thead><tbody>` +
    rowsQ.map(tr).join('') + `</tbody></table></div>` +
    (facts.length ? `<div class="al-facts">${facts.join('')}</div>` : '') +
    `<p class="note">Mediana dos anúncios do prédio (foto de ${FOTO}, preço pedido, área útil). Yield da unidade = 12 × aluguel ÷ preço de venda da mesma unidade anunciada para alugar e vender; “≈ no fechamento” = aluguel pedido ÷ valor ITBI registrado no mesmo prédio (~1,24× o pedido na cidade; defasagem ~2,6%). ${ref}</p>`;
}

/* ════════ SEÇÃO NO DISTRITO ═══════════════════════════════ */
R.registerSection('distrito', {id: 'aluguel', title: 'Aluguel no distrito (QuintoAndar)', order: 20, render: (el, ctx) => renderDistSec(el, ctx)});
function renderDistSec(el, ctx) {
  const cd = ctx.cd;
  if (!AL.D) {
    if (!el.dataset.built) el.innerHTML = `<div class="loading">${AL.err ? 'Aluguel indisponível: abra pela URL do serve.py.' : 'Carregando aluguel…'}</div>`;
    if (!AL.err) loadBase().then(() => { if (S.view === 'distrito' && S.cd === cd) renderDistSec(el, ctx); }).catch(() => {});
    return;
  }
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="al-dhead"><p class="sub al-dsub"></p>${selo()}${R.viewOn && !R.viewOn('aluguel') ? '' : '<button type="button" class="linkbtn al-open">abrir no Radar Aluguel →</button>'}</div><div class="kpis al-dk"></div>` +
      `<div class="al-sm">` +
      `<div class="al-smc"><h4>Aluguel R$/m² útil por quartos</h4><div id="alDq" class="chart" style="height:150px"></div></div>` +
      `<div class="al-smc"><h4>Aluguel R$/m² útil por faixa de área útil</h4><div id="alDa" class="chart" style="height:190px"></div></div>` +
      `<div class="al-smc"><h4>Yield por quartos <small>◇ da unidade (pedido) · ● no fechamento ITBI</small></h4><div id="alDy" class="chart" style="height:150px"></div></div>` +
      `<div class="al-smc"><h4>Condomínio + IPTU no custo de morar</h4><div id="alDp" class="chart" style="height:150px"></div></div>` +
      `<div class="al-smc"><h4>Oferta por 1.000 unidades, por idade do prédio <small>condomínios verticais (≥ 10 unid.); só compara dentro do distrito</small></h4><div id="alDo" class="chart" style="height:190px"></div></div>` +
      `</div><div class="al-leg al-dleg"></div><p class="note al-dnote"></p>`;
    const alo = el.querySelector('.al-open'); if (alo) alo.addEventListener('click', () => { S.p.alFocus = S.cd; R.setView('aluguel'); });
  }
  const g = grupo() || 'apto', st = strat(false), key = st.g ? st.key : `${g}|todos|todos`;
  const r = drow(cd, key), rt = drow(cd, `${g}|todos|todos`), sp = drow('SP', key);
  const glab = g === 'apto' ? 'Apartamento' : 'Casa';
  el.querySelector('.al-dsub').textContent = `${st.g ? stratLabel(st) : glab + ' · todas as faixas (Sala/flat não tem aluguel residencial)'} · preço pedido em área útil · mediana, IQR e n; o traço vertical é a cidade.`;
  const y = r ? dval(r, 'yield') : null, cu = AL.curta && AL.curta.dist[cd];
  el.querySelector('.al-dk').innerHTML = [
    kpi('Aluguel R$/m² útil/mês', r ? fAm2(r.p50) : '—', r ? `IQR ${nf1.format(r.p25)}–${nf1.format(r.p75)} · n=${fN(r.n)}${r.n >= MIN ? '' : ' (baixo)'} · cidade ${sp ? nf1.format(sp.p50) : '—'}` : 'sem anúncio'),
    kpi('Yield da unidade', y && y.v != null ? fY(y.v) : '—', y && y.v != null ? (y.fb ? 'estimado (qaqa): n < 10' : `IQR ${nf1.format(r.y25)}–${nf1.format(r.y75)} · n=${fN(r.yn)}`) : ''),
    kpi('≈ Yield no fechamento', r && r.yi != null ? fY(r.yi) : '—', r && r.yi != null ? `${fN(r.yin)} prédios · 2º número` : 'sem ITBI no mesmo prédio'),
    kpi('Custo de morar', r ? fRs(r.cm) : '—', r && r.peso != null ? `cond. + IPTU ${nf0.format(r.peso)}%` : ''),
    kpi('Anúncios por 1.000 unid.', rt && rt.of != null ? nf1.format(rt.of) : '—', rt ? `${fN(rt.nb)} anúncios · presença, não vacância` : ''),
    kpi('Airbnb', cu ? fN(cu.n) : AL.curta ? '0' : '…', cu ? `${cu.q && cu.q['≤1'] && cu.q['≤1'][6] != null ? `empata em ${nf1.format(cu.q['≤1'][6])} noites/mês (≤1 q.)` : `diária ${fRs(cu.di)}`} · CC BY 4.0` : 'Inside Airbnb 14/06/2026'),
  ].join('');
  if (!AL.curta) loadCurta().then(() => { if (S.view === 'distrito' && S.cd === cd) renderDistSec(el, ctx); }).catch(() => {});
  const V = R.PALS.alug();
  const rowsOf = (dim, fxs) => fxs.map(fx => ({lab: dim === 'quartos' ? QSH[fx] : fx + ' m²', d: drow(cd, `${g}|${dim}|${fx}`), c: drow('SP', `${g}|${dim}|${fx}`)}));
  const rq = rowsOf('quartos', QS), ra = rowsOf('area_util', FA);
  dotIqr('alDq', rq.map(x => ({lab: x.lab, n: x.d && x.d.n, a: x.d && x.d.p25, m: x.d && x.d.p50, b: x.d && x.d.p75, c: x.c && x.c.p50})), {fmt: v => 'R$ ' + nf1.format(v), log: true, V});
  dotIqr('alDa', ra.map(x => ({lab: x.lab, n: x.d && x.d.n, a: x.d && x.d.p25, m: x.d && x.d.p50, b: x.d && x.d.p75, c: x.c && x.c.p50})), {fmt: v => 'R$ ' + nf1.format(v), log: true, V});
  dotIqr('alDy', rq.map(x => ({lab: x.lab, n: x.d && x.d.yn, a: x.d && x.d.y25, m: x.d && x.d.y, b: x.d && x.d.y75, c: x.c && x.c.y, x2: x.d && x.d.yi, n2: x.d && x.d.yin})), {fmt: v => nf1.format(v) + '%', V, second: '≈ no fechamento ITBI'});
  barChart('alDp', rq.map(x => ({lab: x.lab, v: x.d && x.d.peso, n: x.d && x.d.cmn, c: x.c && x.c.peso})), {fmt: v => nf0.format(v) + '%', V, what: 'cond. + IPTU no custo de morar'});
  const id = (AL.idade[cd] || []), ic = Object.fromEntries((AL.idade.SP || []).map(x => [x[0], x]));
  barChart('alDo', ACC.map(a => { const x = id.find(z => z[0] === a); return {lab: a, v: x ? x[5] : null, n: x ? x[3] : null, extra: x, c: ic[a] ? ic[a][5] : null}; }),
    {fmt: v => nf1.format(v), V, what: 'anúncios de aluguel por 1.000 unidades', tipX: x => x.extra ? [['Condomínios (≥ 10 unid.)', fN(x.extra[1])], ['Unidades (IPTU)', fN(x.extra[2])], ['Anúncios de aluguel · venda', `${fN(x.extra[3])} · ${fN(x.extra[4])}`], ['Aluguel R$/m² útil (mediana dos prédios)', x.extra[7] != null ? nf1.format(x.extra[7]) : '—']] : []});
  el.querySelector('.al-dleg').innerHTML = `<span class="it"><i class="al-iqr"></i>IQR</span><span class="it"><i class="al-dia"></i>mediana (pedido)</span><span class="it"><i class="al-cir"></i>≈ yield no fechamento ITBI</span><span class="it"><i class="al-tick"></i>cidade</span><span class="it muted">cinza = n &lt; ${MIN}</span>`;
  el.querySelector('.al-dnote').innerHTML = `Oferta por idade: condomínios com ≥ 10 unidades por ano de entrega (ACC do IPTU). Na cidade, os entregues a partir de 2023 têm 23,5 anúncios por 1.000 unidades, contra 7–8 antes de 2016: prédio novo concentra oferta de aluguel. Entre distritos, a oferta mede presença da plataforma (ρ = 0,90 com o giro do ITBI), não vacância.`;
}
/* ponto (mediana) + barra (IQR) por categoria, com a cidade como traço; opcional 2º marcador cheio (fechamento) */
function dotIqr(id, rows, o) {
  const c = R.chart(id); if (!c) return;
  const ok = rows.map(r => r.m != null && (r.n || 0) >= MIN);
  const cats = rows.map(r => `${r.lab}  n=${r.n == null ? 0 : nf0.format(r.n)}`);
  const vals = rows.flatMap(r => [r.a, r.b, r.c, r.x2, r.m]).filter(v => v != null && v > 0);
  if (!vals.length) { c.clear(); return; }
  const lo = Math.min(...vals), hi = Math.max(...vals), nb = niceBounds(Math.max(0, lo - (hi - lo) * 0.08), hi + (hi - lo) * 0.08), pct = o.fmt(1).includes('%');
  c.setOption(Object.assign(R.base(), {
    grid: {left: 92, right: 14, top: 4, bottom: 20},
    xAxis: R.ax({type: 'value', min: nb.min, max: nb.max, interval: nb.step, axisLabel: {color: css('--muted'), fontSize: 9.5, formatter: v => nf0.format(v) + (pct ? '%' : '')}}),
    yAxis: R.ax({type: 'category', data: cats, inverse: true, splitLine: {show: false}, axisLabel: {color: css('--ink-2'), fontSize: 10}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { const r = rows[p.data && p.data.i != null ? p.data.i : p.dataIndex]; if (!r) return '';
      return tip(r.lab, [['Mediana', r.m != null ? o.fmt(r.m) : '—'], ['IQR', r.a != null ? `${o.fmt(r.a)} – ${o.fmt(r.b)}` : '—'], ['n', fN(r.n)], ['Cidade', r.c != null ? o.fmt(r.c) : '—']]
        .concat(o.second ? [[o.second, r.x2 != null ? `${o.fmt(r.x2)} · ${fN(r.n2)} prédios` : '—']] : []), `foto ${FOTO} · pedido`); }}),
    series: [
      {type: 'custom', silent: true, z: 1, data: rows.map((r, i) => r.a != null && r.b != null ? [i, r.a, r.b] : null).filter(Boolean), encode: {x: [1, 2], y: 0},
        renderItem: (params, api) => { const p1 = api.coord([api.value(1), api.value(0)]), p2 = api.coord([api.value(2), api.value(0)]), h = api.size([0, 1])[1] * 0.42;
          const i = api.value(0); return {type: 'rect', shape: {x: p1[0], y: p1[1] - h / 2, width: Math.max(2, p2[0] - p1[0]), height: h}, style: {fill: ok[i] ? o.V[2] : css('--gray-cell'), opacity: ok[i] ? 0.5 : 0.8}}; }},
      {type: 'scatter', z: 4, symbol: 'rect', symbolSize: [2, 16], data: rows.map((r, i) => r.c != null ? {value: [r.c, i], i} : null).filter(Boolean), itemStyle: {color: css('--muted')}},
      {type: 'scatter', z: 5, symbol: 'diamond', symbolSize: 10, data: rows.map((r, i) => r.m != null ? {value: [r.m, i], i, itemStyle: {color: css('--surface'), borderColor: ok[i] ? css('--ink') : css('--muted'), borderWidth: 1.6}} : null).filter(Boolean)},
    ].concat(o.second ? [{type: 'scatter', z: 6, symbol: 'circle', symbolSize: 7, data: rows.map((r, i) => r.x2 != null ? {value: [r.x2, i], i} : null).filter(Boolean), itemStyle: {color: css('--ink')}}] : []),
  }), true);
}
function barChart(id, rows, o) {
  const c = R.chart(id); if (!c) return;
  const cats = rows.map(r => `{b|${r.v == null ? '—' : o.fmt(r.v)}}  ${r.lab}  n=${r.n == null ? 0 : nf0.format(r.n)}`);
  const hi = Math.max(1, ...rows.flatMap(r => [r.v, r.c]).filter(v => v != null)), nb = niceBounds(0, hi * 1.04);
  c.setOption(Object.assign(R.base(), {
    grid: {left: 4, right: 14, top: 4, bottom: 20, containLabel: true},
    xAxis: R.ax({type: 'value', min: 0, max: nb.max, interval: nb.step, axisLabel: {color: css('--muted'), fontSize: 9.5}}),
    yAxis: R.ax({type: 'category', data: cats, inverse: true, splitLine: {show: false}, axisLabel: {color: css('--ink-2'), fontSize: 10, rich: {b: {color: css('--ink'), fontWeight: 600, fontSize: 10.5}}}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { const r = rows[p.data && p.data.i != null ? p.data.i : p.dataIndex]; if (!r) return '';
      return tip(r.lab, [[o.what, r.v != null ? o.fmt(r.v) : '—'], ['Cidade', r.c != null ? o.fmt(r.c) : '—']].concat(o.tipX ? o.tipX(r) : [['n', fN(r.n)]]), `foto ${FOTO} · pedido`); }}),
    series: [
      {type: 'bar', barWidth: '52%', data: rows.map((r, i) => ({value: r.v, i, itemStyle: {color: (r.n || 0) >= MIN ? o.V[2] : css('--gray-cell')}}))},
      {type: 'scatter', z: 4, symbol: 'rect', symbolSize: [2, 16], data: rows.map((r, i) => r.c != null ? {value: [r.c, i], i} : null).filter(Boolean), itemStyle: {color: css('--ink')}},
    ],
  }), true);
}
