/* ════════ Radar ITBI · módulo FLIPS (a mesma unidade revendida rápido) ════════
   Dados: flips/*.json (build_flips.py, sobre research/stage/fase2_revendas.parquet do A2), sob demanda, nunca no HTML.
   Regras (A2 · P-A2-4..12; A6 · P4, H11–H13; decisões do orquestrador):
   - FLIP = revenda válida da MESMA unidade (SQL) com holding ≤ 12 m; "revenda rápida" (12–24 m) é camada secundária;
     < 3 m (relâmpago, maior risco de artefato) sempre à parte. Planta → planta = repasse (fora); mesmo valor exato =
     re-registro (fora); registro em duas etapas (planta → 1ª guia do SQL em ≤ 12 m, razão 0,85–1,15) colapsado
     (P-A2-8: holding medido desde a planta); venda registrada como planta depois de SQL próprio = colisão (fora).
   - Mapa só com TAXA (flips por 1.000 unid. do estoque IPTU por ano, ou % dos negócios de unidade pronta); n ≥ 10
     para colorir (cinza com n); 1T só cidade e zonas; quintis fixos do 8T = a mesma legenda nas janelas.
   - Ganho SEMPRE "bruto declarado" (sem reforma, sem IR); mediana e p25–p75, nunca média; n_ganho visível; líquido
     com premissas visíveis (entrada +4,5%, saída −6%). Perda em vermelho: aqui ganho é bom/ruim de fato.
   - Rankings: distritos n ≥ 30 (8T); ruas n ≥ 8 e estoque ≥ 300; prédios n ≥ 5 (8T) ou ≥ 8 (20T), pelo limite
     inferior de Wilson da taxa. Comprador e vendedor não existem no ITBI: flip é revenda rápida, não um investidor. */
const {S, esc, nf0, nf1, nf2, css, clamp, tip, kpi, $} = R;
const DIR = 'flips/', SEGS = ['apto', 'casa', 'sala'], NMIN = 10;
const MK = ['n', 'ng', 'h25', 'h50', 'h75', 'r25', 'r50', 'r75', 'n25', 'n50', 'n75', 'c25', 'c50', 'c75', 'bate', 'perda', 'cvvr', 'vvvr', 'finc', 'finv', 'lucro', 'aa', 'x25', 'x50', 'x75'];
const NM = MK.length;
const CAM = {madura: ['madura', 'Estoque maduro: prédio com mais de 3 anos na venda (padrão)'],
  lancamento: ['lançamento', 'Prédio com até 3 anos na venda ou compra na planta · cuidado: a transição planta → escritura gera ruído (P-A2-8)'],
  todas: ['todas', 'Madura + lançamento']};
const GLB = {nom: 'nominal', real: 'real (IPCA)', cdi: 'acima do CDI', mkt: 'acima do mercado'};
const GTT = {nom: 'Venda ÷ compra − 1, em R$ correntes', real: 'Deflacionado pelo IPCA mês a mês', cdi: 'Excesso sobre o CDI acumulado no mesmo período',
  mkt: 'Alfa do flip (P-A2-12): ganho nominal descontada a variação do índice TTM de R$/m² do distrito × tipo entre o trimestre da compra e o da venda'};
const TLB = {apto: 'Apartamento', casa: 'Casa', sala: 'Sala/flat comercial'};
const MY_METS = ['flips_mil', 'flips_pct'];

/* ── estado (URL) ─────────────────────────────────────── */
const PAR = [
  ['fw', 'flW', v => [1, 4, 8].includes(+v) ? +v : 8, '8'],
  ['fh', 'flH', v => +v === 24 ? 24 : 12, '12'],
  ['fg', 'flG', v => GLB[v] ? v : 'real', 'real'],
  ['fc', 'flC', v => CAM[v] ? v : 'madura', 'madura'],
  ['fq', 'flQ', v => /^[1-4]T20\d\d$/.test(v || '') ? v : '', ''],
  ['fr', 'flR', v => v || 'SP', 'SP'],
  ['fm', 'flM', v => v === 'pneg' ? 'pneg' : 'rate', 'rate'],
  ['ft', 'flT', v => ['predios', 'ruas', 'tip'].includes(v) ? v : 'predios', 'predios'],
  ['fa', 'flA', v => v === 'per' ? 'per' : 'aa', 'aa'],
  ['fj', 'flJ', v => +v === 20 ? 20 : 8, '8'],
];
PAR.forEach(([k, sk, f, d]) => { S.p[sk] = f(d); R.registerParam({k, get: () => String(S.p[sk]), set: v => { S.p[sk] = f(v); }, def: d, views: ['flips']}); });

/* ── dados ─────────────────────────────────────────────── */
const FL = {got: {}, bad: {}, pend: {}};
function prep(path, j) {
  if (path === 'ruas.json' || path === 'predios.json') {
    for (const k in j.t) j.t[k] = j.t[k].map(a => { const o = {}; j.f.forEach((n, i) => { o[n] = a[i]; }); return o; });
  }
  return j;
}
function loadP(path) {
  if (FL.got[path]) return Promise.resolve(FL.got[path]);
  if (FL.pend[path]) return FL.pend[path];
  return FL.pend[path] = R.loadJSON(DIR + path).then(j => { FL.got[path] = prep(path, j); delete FL.bad[path]; delete FL.pend[path]; return FL.got[path]; })
    .catch(e => { FL.bad[path] = String(e && e.message || e); delete FL.pend[path]; throw e; });
}
let kT = 0;
const myView = () => S.view === 'flips' || (S.view === 'cidade' && MY_METS.includes(S.met));
function kick() { clearTimeout(kT); kT = setTimeout(() => { if (myView()) R.render(); }, 40); }
/* acesso síncrono (vistas que se redesenham quando o arquivo chega) */
function get(path) { if (FL.got[path]) return FL.got[path]; if (!FL.pend[path] && !FL.bad[path]) loadP(path).then(kick, kick); return null; }
const meta = () => get('meta.json');
const seg = () => SEGS.includes(S.tipo) ? S.tipo : 'apto';
const cube = (sg = seg(), cam = S.p.flC) => get(`d/${sg}_${cam}.json`);
const offline = () => Object.keys(FL.bad).length ? `Dados de flips indisponíveis (${esc(Object.values(FL.bad)[0])}): abra pela URL do serve.py (flips/*.json).` : '';

/* registro do cubo: região × janela × trimestre final × holding máximo → métricas (+ derivadas) */
function rec(C, reg, w, qi, h) {
  if (!C || qi == null || qi < 0) return null;
  const rows = C.r[reg] && C.r[reg][String(w)], a = rows && rows[qi]; if (!a) return null;
  const off = h === 24 ? NM : 0, o = {reg, w, h, q: C.q[qi], qi};
  MK.forEach((k, i) => { o[k] = a[off + i]; });
  o.rel = a[2 * NM]; o.rev = a[2 * NM + 1]; o.neg = a[2 * NM + 2]; o.est = a[2 * NM + 3];
  o.rate = o.est ? o.n / o.est * 1000 * 4 / w : null;
  o.pneg = o.neg ? 100 * o.n / o.neg : null;
  o.prev = o.rev ? 100 * o.n / o.rev : null;
  o.ok = o.n >= NMIN;
  return o;
}
function qiSel(C) { if (!C) return null; const i = S.p.flQ ? C.q.indexOf(S.p.flQ) : -1; return i >= 4 ? i : C.q.length - 1; }
const qnum = l => +l.slice(-4) * 4 + (+l[0] - 1), qlab = n => `${n % 4 + 1}T${Math.floor(n / 4)}`;
const qSpan = (q, w) => w === 1 ? q : `${qlab(qnum(q) - w + 1)}–${q}`;
const lastQ = () => (meta() && meta().q_fim) || '2T2026';
const gq = (o, g = S.p.flG) => { if (!o) return [null, null, null]; const p = g === 'nom' ? 'n' : g === 'cdi' ? 'c' : g === 'mkt' ? 'x' : 'r'; return [o[p + '25'], o[p + '50'], o[p + '75']]; };
const FLIQ = () => (meta() && meta().fator_liq) || 0.94 / 1.045;
const liq = v => v == null ? null : ((1 + v / 100) * FLIQ() - 1) * 100;
const regName = r => r === 'SP' ? 'Cidade de São Paulo' : r[0] === 'Z' ? 'Zona ' + r.slice(1) : R.dname(r);
const isDist = r => r !== 'SP' && r[0] !== 'Z';

/* ── incerteza ─────────────────────────────────────────── */
function poisCI(n) {   // IC95% de uma contagem (Wilson–Hilferty); a taxa por estoque herda o intervalo
  if (n == null) return null; const z = 1.96, m = n + 1;
  const lo = n === 0 ? 0 : n * Math.pow(1 - 1 / (9 * n) - z / (3 * Math.sqrt(n)), 3);
  return [Math.max(0, lo), m * Math.pow(1 - 1 / (9 * m) + z / (3 * Math.sqrt(m)), 3)];
}
function wilson(k, n) { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - a) / d * 100, (c + a) / d * 100]; }
const medCI = (m, a, b, n) => m == null || a == null || b == null || !n ? null : [m - 1.58 * (b - a) / Math.sqrt(n), m + 1.58 * (b - a) / Math.sqrt(n)];
function qpois(p, mu) {   // quantil de Poisson com interpolação (Spiegelhalter 2005) — limites do funil
  if (mu <= 0) return 0;
  if (mu > 300) { const z = p < 0.5 ? -zOf(p) : zOf(p); return Math.max(0, mu + z * Math.sqrt(mu)); }
  let k = 0, pr = Math.exp(-mu), cum = pr;
  while (cum < p && k < 4000) { k++; pr *= mu / k; cum += pr; }
  return Math.max(0, k - (cum - p) / pr);
}
const zOf = p => ({0.975: 1.96, 0.025: 1.96, 0.999: 3.09, 0.001: 3.09})[p] || 1.96;

/* ── formatação ────────────────────────────────────────── */
const fRate = v => v == null ? '—' : nf2.format(v);
const fMes = v => v == null ? '—' : nf1.format(v) + ' m';
const fP = v => v == null ? '—' : nf1.format(v) + '%';
const fX = v => v == null ? '—' : nf2.format(v) + '×';
const fG = v => v == null ? '—' : R.fSig(v);
const fRs = v => v == null ? '—' : 'R$ ' + nf0.format(v);
const fD = v => v == null ? '—' : (v >= 0 ? '+' : '−') + nf2.format(Math.abs(v));
const gray = (s, on) => on ? `<span class="gray" title="n abaixo de ${NMIN} flips: valor frágil">${s}</span>` : s;
const dot = v => v == null ? '' : `<i class="fl-gl ${v < 0 ? 'neg' : 'pos'}" aria-hidden="true"></i>`;
const bandCols = () => { const s = R.RAMP[R.mode()].seq; return {f312: s[5], rel: s[3], f1224: s[1]}; };
const HATCH = {symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -Math.PI / 4, color: 'rgba(255,255,255,0.55)'};
function freshChart(el) { el.querySelectorAll('.chart').forEach(d => { const c = window.echarts && echarts.getInstanceByDom(d); if (c) c.dispose(); }); }

/* ════════ COR DOS DISTRITOS (mapa da Cidade) ════════════ */
/* padrão fixo e explícito: 8T até o último trimestre completo, estoque maduro, holding ≤ 12 m, tipo do estrato */
function cityRec(cd, back = 0) { const C = get(`d/${seg()}_madura.json`); return C ? rec(C, cd, 8, C.q.length - 1 - back, 12) : null; }
function metTip(cd) {
  const o = cityRec(cd), p = cityRec(cd, 4);
  if (!o) return tip(R.dname(cd), [['Flips', offline() ? 'dados indisponíveis (serve.py)' : 'carregando…']]);
  const ci = poisCI(o.n), k = o.est ? 1000 * 4 / 8 / o.est : null;
  return tip(R.dname(cd), [
    ['Flips em 8T (holding ≤ 12 m)', nf0.format(o.n) + (o.ok ? '' : ' (n baixo: cinza)') + (o.rel ? ` · ${nf0.format(o.rel)} em < 3 m` : '')],
    ['Por 1.000 unid./ano', o.rate != null ? `${fRate(o.rate)} [IC ${fRate(ci[0] * k)}–${fRate(ci[1] * k)}]` : '—'],
    ['% dos negócios de unidade pronta', fP(o.pneg)],
    ['Holding mediano', o.h50 != null ? `${fMes(o.h50)} (IQR ${nf1.format(o.h25)}–${nf1.format(o.h75)})` : '—'],
    ['Ganho real bruto declarado', o.r50 != null ? `${fG(o.r50)} (IQR ${fG(o.r25)} a ${fG(o.r75)}) · n=${o.ng}` : '—'],
    ['Bate o CDI', o.bate != null ? fP(o.bate) + ' dos flips com ganho' : '—'],
    ['Δ taxa vs 4T antes', p && p.rate != null && o.rate != null ? `${fD(o.rate - p.rate)} (era ${fRate(p.rate)}, n=${p.n})` : '—'],
    ['Estoque (IPTU)', o.est ? nf0.format(o.est) + ' unid.' : '—']],
    `${TLB[seg()]} · madura · ${qSpan(o.q, 8)} · ganho sem reforma nem IR · clique para abrir o distrito`);
}
R.registerMetric({id: 'flips_mil', label: 'Flips/1.000 un.', group: 'Flips', order: 10, palette: 'seq',
  title: 'Flips (a mesma unidade revendida em até 12 meses) por 1.000 unidades do estoque IPTU, por ano · 8 trimestres · estoque maduro (prédio > 3 anos) · tipo do estrato',
  value: cd => { const o = cityRec(cd); return o && o.est ? o.rate : null; },
  ok: cd => { const o = cityRec(cd); return !!(o && o.ok); },
  fmt: v => nf2.format(v),
  legendLabel: () => `Flips por 1.000 unid./ano · ${TLB[seg()].toLowerCase()} · madura · 8T até ${lastQ()}`,
  tip: metTip});
R.registerMetric({id: 'flips_pct', label: '% flips', group: 'Flips', order: 20, palette: 'seq',
  title: 'Flips ÷ negócios de unidade pronta (SQL próprio, sem planta) · 8 trimestres · estoque maduro · tipo do estrato',
  value: cd => { const o = cityRec(cd); return o && o.neg ? o.pneg : null; },
  ok: cd => { const o = cityRec(cd); return !!(o && o.ok); },
  fmt: v => nf1.format(v) + '%',
  legendLabel: () => `Flips ÷ negócios de unidade pronta · ${TLB[seg()].toLowerCase()} · madura · 8T até ${lastQ()}`,
  tip: metTip});

/* ════════ CAMADA: lotes com flip (anel de tinta; espessura = nº de flips em 5 anos) ════════ */
const BYID = new WeakMap();
function byId(F) { let m = BYID.get(F); if (!m) { m = {}; F.lots.forEach(l => { m[l.id] = l; }); BYID.set(F, m); } return m; }
const WEXP = ['interpolate', ['linear'], ['get', 'n12'], 0, 1.2, 1, 1.6, 3, 3, 8, 5.5];
function ringSt(H) { return H._flr || (H._flr = {cds: [], t: 0, fc: R.EMPTY_FC}); }
function ringsAdd(H, pre) {
  const map = H.map;
  R.upsertSrc(map, pre + 'src', ringSt(H).fc, true);
  R.addLayerOnce(map, {id: pre + 'hit', type: 'fill', source: pre + 'src', minzoom: 13, paint: {'fill-color': '#000000', 'fill-opacity': 0}});
  R.addLayerOnce(map, {id: pre + 'halo', type: 'line', source: pre + 'src', minzoom: 13, layout: {'line-join': 'round'}, paint: {'line-width': ['+', WEXP, 2.4], 'line-opacity': 0.85}});
  R.addLayerOnce(map, {id: pre + 'solid', type: 'line', source: pre + 'src', minzoom: 13, filter: ['>', ['get', 'n12'], 0], layout: {'line-join': 'round'}, paint: {'line-width': WEXP}});
  R.addLayerOnce(map, {id: pre + 'dash', type: 'line', source: pre + 'src', minzoom: 13, filter: ['==', ['get', 'n12'], 0], paint: {'line-width': 1.3, 'line-dasharray': [2, 1.6]}});
  map.setPaintProperty(pre + 'halo', 'line-color', css('--surface'));
  map.setPaintProperty(pre + 'solid', 'line-color', css('--ink'));
  map.setPaintProperty(pre + 'dash', 'line-color', css('--ink'));
}
function ringsVis(H, pre, on) { ['hit', 'halo', 'solid', 'dash'].forEach(k => R.visL(H.map, pre + k, on)); }
function ringsLoad(H, pre, on) {
  const st = ringSt(H);
  clearTimeout(st.t);
  st.t = setTimeout(() => {
    if (!H.ready) return;
    const map = H.map;
    if (!on() || map.getZoom() < 12.5) { if (st.cds.length) { st.cds = []; ringsSet(H, pre); } return; }
    const b = map.getBounds(), bb = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const cds = R.DCODES.filter(cd => { const q = R.DIST[cd].bb; return !(q[2] < bb[0] || q[0] > bb[2] || q[3] < bb[1] || q[1] > bb[3]); }).slice(0, 8);
    st.cds = cds;
    Promise.allSettled(cds.map(cd => Promise.all([R.fetchDist(cd), loadP('anel/' + cd + '.json')]))).then(rs => {
      ringsSet(H, pre);
      if (rs.some(r => r.status === 'rejected') && H.setMsgExt) H.setMsgExt('Lotes com flip indisponíveis: abra pelo serve.py');
    });
  }, 250);
}
function ringsSet(H, pre) {
  const st = ringSt(H), feats = [];
  for (const cd of st.cds) {
    const F = R.DFILE[cd], A = FL.got['anel/' + cd + '.json']; if (!F || !A) continue;
    const ix = byId(F);
    for (const id in A.lots) {
      const l = ix[id]; if (!l) continue; const a = A.lots[id];
      feats.push({type: 'Feature', geometry: R.lotFeature(l), properties: {cd, id, n12: a[0], n24: a[1], rel: a[2], hmed: a[3], gmed: a[4], ng: a[5], nm: l.nm || l.end || ''}});
    }
  }
  st.fc = {type: 'FeatureCollection', features: feats};
  const s = H.ready && H.map.getSource(pre + 'src'); if (s) s.setData(st.fc);
}
function ringTip(p) {
  return tip(p.nm || 'Lote ' + p.id, [
    ['Flips ≤ 12 m (5 anos)', nf0.format(p.n12 || 0) + (p.rel ? ` · ${p.rel} em < 3 m (relâmpago)` : '')],
    ['Revendas ≤ 24 m (5 anos)', nf0.format(p.n24 || 0)],
    ['Holding mediano dos flips', fMes(p.hmed)],
    ['Ganho real bruto declarado (mediana)', p.gmed != null ? `${fG(p.gmed)} · n=${p.ng}` : '—']],
    'qualquer unidade do lote · até 07/08/2026 · clique para abrir o prédio (cadeias compra → venda)');
}
const ringLegend = () => `<span class="it"><i class="fl-ring" aria-hidden="true"></i>lote com flip ≤ 12 m em 5 anos (espessura = nº de flips)</span><span class="it"><i class="fl-ring d" aria-hidden="true"></i>só revenda rápida (12–24 m)</span>`;
R.registerLayer({id: 'flips', group: 'Mercado secundário', order: 20, label: 'Lotes com flip', minzoom: 13, def: false,
  title: 'Anel de tinta nos lotes com flip (a mesma unidade revendida em até 12 meses) nos últimos 5 anos; espessura = nº de flips; tracejado = só revenda rápida (12–24 m)',
  add: H => ringsAdd(H, 'app-flips-'),
  update: H => ringsLoad(H, 'app-flips-', () => R.camHas('flips')),
  setVisible: (H, on) => ringsVis(H, 'app-flips-', on),
  onMove: H => ringsLoad(H, 'app-flips-', () => R.camHas('flips')),
  hitLayers: () => ['app-flips-hit'],
  tip: f => ringTip(f.properties),
  click: f => R.openLot(f.properties.cd, f.properties.id),
  legend: () => ringLegend() + `<span class="it muted">flips: 5 anos até 07/08/2026, qualquer tipo de unidade do lote</span>`,
  note: () => 'Revenda da mesma unidade em ≤ 12 m (5 anos); tracejado = só 12–24 m'});
R.registerPreset({id: 'flips', label: 'Flips', order: 30, met: 'flips_mil', cam: ['flips'],
  title: 'Flips por 1.000 unidades/ano por distrito (8T, estoque maduro) e anel nos lotes com flip'});

/* ════════ VISTA: Radar de flips ═════════════════════════ */
const HTML = `<div class="vhead"><div><span class="eyebrow">Radar · Flips</span><h2>Onde a mesma unidade é revendida rápido, em quanto tempo e com quanto de ganho</h2></div>
  <p>Cada par compra → venda da <b>mesma unidade</b> (SQL) no ITBI. Flip = revenda em até 12 meses; 12–24 meses = revenda rápida; menos de 3 meses = relâmpago, mostrado à parte. O mapa mostra só taxas (o estoque explica o volume, não a taxa). Ganho = valor declarado nas guias, bruto.</p></div>
  <div class="ctrlrow fl-ctrl" id="flCtrl" role="group" aria-label="Filtros do radar de flips"></div>
  <p class="fl-def" id="flDef"></p>
  <div class="kpis fl-kpis" id="flKpis"></div>
  <div class="fl-grid">
    <div class="card" style="padding:8px 10px 10px"><div class="fl-mhead" id="flMhead"></div><div id="flMap" class="chart map" role="img" aria-label="Mapa: taxa de flips por distrito"></div><div class="legend" id="flLeg"></div></div>
    <div class="card"><h3>Quente de verdade? Funil de Spiegelhalter</h3><p class="sub" id="flFunSub"></p><div id="flFun" class="chart" style="height:460px" role="img" aria-label="Funil: taxa de flips × estoque por distrito"></div><div class="legend" id="flFunLeg"></div></div>
  </div>
  <div class="card"><h3 id="flSerT">Flips por trimestre</h3><p class="sub" id="flSerSub"></p><div id="flSer" class="chart" style="height:220px"></div><div id="flSerP" class="chart" style="height:140px"></div><div class="legend" id="flSerLeg"></div></div>
  <div class="two">
    <div class="card"><h3>Ganho por faixa de holding · cidade</h3><p class="sub" id="flDistSub"></p><div class="ctrlrow" id="flDistCtrl" style="margin:2px 0 4px"></div><div id="flDist" class="chart" style="height:250px"></div><div class="legend" id="flDistLeg"></div></div>
    <div class="card"><h3>Comprou na planta → revendeu</h3><p class="sub">Unidades compradas na planta (guia sobre o terreno ligada ao SQL individualizado) e revendidas. Holding medido desde a guia da planta.</p><div id="flPl"></div></div>
  </div>
  <div class="card"><div class="fl-tabs" id="flTabs" role="tablist" aria-label="Rankings"></div><p class="sub" id="flRkSub"></p><div id="flRkCtl" class="ctrlrow" style="margin-bottom:6px"></div><div class="tablewrap tall" id="flRk" style="max-height:520px"></div><div id="flTipo"></div></div>
  <div class="card fl-notes" id="flNotes"></div>`;
R.registerView({id: 'flips', label: 'Flips', sub: 'revenda rápida, holding, ganho', group: 'radar', order: 30, html: HTML, render: renderFlips,
  estrato: {tipos: ['apto', 'casa', 'sala'], dims: ['area', 'padrao', 'idade', 'quartos'], why: 'Flips: apartamento, casa e sala (o estoque do IPTU dá o denominador)'},
  railNote: 'Flips por tipo de unidade (estoque do IPTU no denominador). A faixa do topo destaca a linha na aba Tipologias. Ganho = valor declarado nas guias (bruto: sem reforma, IR ou custos).'});

function renderFlips() {
  const M = meta(), C = cube();
  renderCtrl(C, M);
  if (!M || !C) {
    const off = offline();
    $('flKpis').innerHTML = kpi('Flips', off ? '—' : '…', off || 'carregando…');
    return;
  }
  const regs = allRegs(M);
  if (!regs.includes(S.p.flR)) S.p.flR = 'SP';
  R.safe('flips · definição', () => renderDef(C, M));
  R.safe('flips · KPIs', () => renderKpis(C, M));
  R.safe('flips · mapa', () => radarMap(C));
  R.safe('flips · funil', () => renderFunnel(C));
  R.safe('flips · série', () => renderSerie(C, M));
  R.safe('flips · distribuição', () => renderDist(C, M));
  R.safe('flips · planta', () => renderPlanta(M));
  R.safe('flips · rankings', () => renderRank(C, M));
  R.safe('flips · notas', () => renderNotes(M));
  R.renderSections('flips', {});
}
const allRegs = M => ['SP'].concat(M.zonas.map(z => 'Z' + z)).concat(R.DCODES.slice().sort((a, b) => R.dname(a).localeCompare(R.dname(b), 'pt')));
function segBtns(k, opts, cur) {
  return `<div class="seg" data-k="${k}">${opts.map(([v, l, t]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(cur) === String(v)}"${t ? ` title="${esc(t)}"` : ''}>${l}</button>`).join('')}</div>`;
}
function renderCtrl(C, M) {
  const qs = C ? C.q.slice(4).reverse() : [], qsel = C ? C.q[qiSel(C)] : '';
  const regs = M ? allRegs(M) : ['SP'];
  $('flCtrl').innerHTML =
    `<span class="lab">Janela</span>${segBtns('flW', [[1, '1T', '1 trimestre: só cidade e zonas (o distrito tem mediana de ~6 flips por trimestre)'], [4, '4T', 'últimos 4 trimestres'], [8, '8T', 'últimos 8 trimestres (padrão)']], S.p.flW)}` +
    `<label class="fl-sel" title="Trimestre final da janela (últimos 20)">até <select id="flQsel">${qs.map(q => `<option value="${q}"${q === qsel ? ' selected' : ''}>${q}</option>`).join('')}</select></label>` +
    `<span class="lab">Holding máx.</span>${segBtns('flH', [[12, '12 m', 'Flip: holding ≤ 12 meses (100% do excesso de risco de revenda)'], [24, '24 m', 'Inclui a revenda rápida de 12–24 meses (indistinguível do giro normal)']], S.p.flH)}` +
    `<span class="lab">Ganho</span>${segBtns('flG', Object.keys(GLB).map(k => [k, GLB[k], GTT[k]]), S.p.flG)}` +
    `<span class="lab">Camada</span>${segBtns('flC', Object.entries(CAM).map(([k, v]) => [k, v[0], v[1]]), S.p.flC)}` +
    `<label class="fl-sel">Recorte <select id="flRsel">${regs.map(r => `<option value="${esc(r)}"${r === S.p.flR ? ' selected' : ''}>${esc(regName(r))}</option>`).join('')}</select></label>`;
}
$('flCtrl').addEventListener('click', e => {
  const b = e.target.closest('.seg[data-k] button'); if (!b) return;
  const k = b.closest('.seg').dataset.k, v = b.dataset.v;
  S.p[k] = ['flW', 'flH'].includes(k) ? +v : v;
  R.render();
});
$('flCtrl').addEventListener('change', e => {
  if (e.target.id === 'flQsel') { const C = cube(); S.p.flQ = C && e.target.value === C.q[C.q.length - 1] ? '' : e.target.value; R.render(); }
  if (e.target.id === 'flRsel') { S.p.flR = e.target.value; R.render(); }
});

function renderDef(C, M) {
  const qi = qiSel(C), w = S.p.flW, cam = S.p.flC;
  const p8 = M.p_a2_8 || {};
  $('flDef').innerHTML = `<b>${TLB[seg()]}</b> · ${esc(CAM[cam][0])} · holding ≤ ${S.p.flH} m · janela ${w}T <b>${qSpan(C.q[qi], w)}</b> · ${esc(regName(S.p.flR))}` +
    (cam !== 'madura' ? ` <span class="fl-warn">Lançamento: parte das revendas curtas é o registro em duas etapas (planta → escritura). Colapsamos o caso ligado (P-A2-8: ${nf0.format(p8.pares_2e || 0)} pares; holding desde a planta) e tiramos ${nf0.format(p8.flips_art_pl || 0)} colisões de unidade; a ponte planta → unidade cobre só 26–30% das safras 2021–23.</span>` : '');
}

/* ── KPIs com IC/IQR ───────────────────────────────────── */
function renderKpis(C, M) {
  const qi = qiSel(C), w = S.p.flW, h = S.p.flH, reg = S.p.flR, g = S.p.flG;
  if (isDist(reg) && w === 1) {
    $('flKpis').innerHTML = kpi('1T por distrito', '—', 'mediana de ~6 flips por distrito e trimestre: use 4T ou 8T (ou recorte cidade/zona)');
    return;
  }
  const o = rec(C, reg, w, qi, h), p = rec(C, reg, w, qi - 4, h);
  if (!o) { $('flKpis').innerHTML = kpi('Flips', '0', 'sem flips no recorte e na janela'); return; }
  const low = !o.ok, k = o.est ? 1000 * 4 / w / o.est : null, ci = poisCI(o.n), wi = wilson(o.n, o.neg);
  const [g25, g50, g75] = gq(o, g), gci = medCI(g50, g25, g75, o.ng), hci = medCI(o.h50, o.h25, o.h75, o.n);
  const L = CAM[S.p.flC][0];
  $('flKpis').innerHTML = [
    kpi(`Flips (${w}T)`, gray(nf0.format(o.n), low), `${nf0.format(o.rel || 0)} em &lt; 3 m (relâmpago) · ${p ? `4T antes: ${nf0.format(p.n)}` : ''}`),
    kpi('% dos negócios', gray(fP(o.pneg), low), `${wi ? `IC ${nf1.format(wi[0])}–${nf1.format(wi[1])}%` : ''} · ${fP(o.prev)} das revendas`),
    kpi('Por 1.000 unid./ano', gray(fRate(o.rate), low), o.rate != null ? `IC ${fRate(ci[0] * k)}–${fRate(ci[1] * k)} · Δ4T ${p && p.rate != null ? fD(o.rate - p.rate) : '—'}` : 'sem estoque'),
    kpi('Holding mediano', gray(fMes(o.h50), low), o.h50 != null ? `IQR ${nf1.format(o.h25)}–${nf1.format(o.h75)} m${hci ? ` · IC ${nf1.format(Math.max(0, hci[0]))}–${nf1.format(hci[1])}` : ''}` : ''),
    kpi(g === 'mkt' ? 'Ganho acima do índice do distrito' : `Ganho ${GLB[g]} bruto`, gray(fG(g50), o.ng < NMIN), g50 != null ? `IQR ${fG(g25)} a ${fG(g75)} · n=${nf0.format(o.ng)}${gci ? ` · IC ${nf0.format(gci[0])} a ${nf0.format(gci[1])}` : ''}` : `n=${o.ng}`),
    kpi('Com perda real', gray(fP(o.perda), o.ng < NMIN), `ganho real &lt; 0 · n=${nf0.format(o.ng)}`),
    kpi('Acima do CDI', gray(fP(o.bate), o.ng < NMIN), 'bateu o CDI acumulado no período'),
    kpi('Líquido de custos (real)', gray(fG(liq(o.r50)), o.ng < NMIN), 'entrada +4,5% · saída −6% · sem IR nem reforma'),
    kpi('Compra → venda ÷ VVR', `${fX(o.cvvr)} → ${fX(o.vvvr)}`, `financiada: compra ${fP(o.finc)} · venda ${fP(o.finv)}`),
    kpi('Lucro real mediano', gray(fRs(o.lucro), o.ng < NMIN), `bruto, R$ da data da venda · ${esc(L)}`),
  ].join('');
}

/* ── mapa do radar: coroplético da taxa (quintis fixos do 8T), cinza n < 10, 1T pinta a zona ── */
let MF = null; const MFS = {fitted: false};
const QCOLS = () => { const st = R.PALS.seq(); return [0.08, 0.3, 0.52, 0.74, 0.96].map(t => R.ramp(st, t)); };
function paintState(C) {
  const qi = qiSel(C), w = S.p.flW, h = S.p.flH, met = S.p.flM;
  const val = o => o ? (met === 'pneg' ? o.pneg : o.rate) : null;
  const ref = R.DCODES.map(cd => rec(C, cd, 8, C.q.length - 1, h)).filter(o => o && o.ok).map(val).filter(v => v != null).sort((a, b) => a - b);
  const br = [0.2, 0.4, 0.6, 0.8].map(p => R.qt(ref, p)), cols = QCOLS();
  const cls = v => br.filter(b => b != null && v > b).length;
  const color = {}, recs = {};
  R.DCODES.forEach(cd => {
    const o = w === 1 ? rec(C, 'Z' + R.DIST[cd].r5, 1, qi, h) : rec(C, cd, w, qi, h), v = val(o);
    recs[cd] = o; color[cd] = o && o.ok && v != null ? cols[cls(v)] : null;
  });
  return {color, recs, br, cols, val, qi, w, h, met, nref: ref.length};
}
function radarMap(C) {
  if (!MF) { MF = R.createBaseMap($('flMap'), {layers: {predios: 'off', lotes: 'off'}, onStyle: H => mapApply(H)}); if (MF) wireRadar(); }
  if (!MF) return;
  mapApply(MF);
  if (!MFS.fitted) { MFS.fitted = true; MF.fit({bounds: [[-46.83, -23.80], [-46.36, -23.36]], padding: 8, maxZoom: 12, pitch: 0, bearing: 0}); }
  const P = paintState(C), fmt = S.p.flM === 'pneg' ? (v => nf1.format(v) + '%') : (v => nf2.format(v));
  const lab = S.p.flM === 'pneg' ? '% dos negócios de unidade pronta' : 'Flips por 1.000 unid./ano';
  const bins = P.cols.map((c, i) => `<span class="fl-q" style="background:${c}" title="quintil ${i + 1}"></span><small>${i === 0 ? '≤ ' + fmt(P.br[0]) : i === 4 ? '> ' + fmt(P.br[3]) : fmt(P.br[i - 1]) + '–' + fmt(P.br[i])}</small>`).join('');
  $('flMhead').innerHTML = `<div class="seg" data-k="flM">${[['rate', 'por 1.000 unid./ano', 'Flips ÷ estoque de unidades do IPTU × 1.000 × 4/janela'], ['pneg', '% dos negócios', 'Flips ÷ negócios de unidade pronta (SQL próprio, sem planta)']].map(([v, l, t]) => `<button type="button" data-v="${v}" aria-pressed="${S.p.flM === v}" title="${esc(t)}">${l}</button>`).join('')}</div>` +
    `<label class="chk" title="Círculo com área proporcional ao nº de flips (contagem não vai na cor)"><input type="checkbox" id="flCirc"${S.p.flCirc ? ' checked' : ''}> círculos = nº de flips</label>` +
    (P.w === 1 ? `<span class="fl-warn">1T: cor da <b>zona</b> (distrito tem mediana de ~6 flips por trimestre)</span>` : '');
  $('flLeg').innerHTML = `<span class="scale"><b style="font-weight:500;color:var(--ink)">${lab}</b> ${bins}</span>` +
    `<span class="it"><i class="dot" style="border-radius:2px;background:var(--gray-cell)"></i>n &lt; ${NMIN} flips</span>` +
    `<span class="it muted">quintis dos ${P.nref} distritos com n ≥ ${NMIN} em 8T até ${C.q[C.q.length - 1]}: a mesma legenda vale em 1T/4T/8T · ${TLB[seg()].toLowerCase()} · ${esc(CAM[S.p.flC][0])} · holding ≤ ${P.h} m</span>` +
    `<span class="it muted">zoom ≥ 13:</span>${ringLegend()}`;
}
$('flMhead') && $('flMhead').addEventListener('click', e => { const b = e.target.closest('.seg[data-k] button'); if (b) { S.p.flM = b.dataset.v; R.render(); } });
$('flMhead') && $('flMhead').addEventListener('change', e => { if (e.target.id === 'flCirc') { S.p.flCirc = e.target.checked; if (MF) mapApply(MF); } });
function mapApply(H) {
  if (!H || !H.ready) return;
  const C = cube(); if (!C) return;
  const map = H.map, P = paintState(C), below = R.firstSymbol(map);
  const fc = {type: 'FeatureCollection', features: R.DF.map(f => ({type: 'Feature', geometry: f.geometry, properties: {cd: f.properties.cd, fc: P.color[f.properties.cd] || css('--gray-cell')}}))};
  R.upsertSrc(map, 'app-fl-dist', fc);
  R.addLayerOnce(map, {id: 'app-fl-dist-fill', type: 'fill', source: 'app-fl-dist', paint: {'fill-color': ['get', 'fc']}}, below);
  R.addLayerOnce(map, {id: 'app-fl-dist-line', type: 'line', source: 'app-fl-dist', layout: {'line-join': 'round'}, paint: {}}, below);
  map.setPaintProperty('app-fl-dist-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 10, 0.78, 13, 0.4, 15, 0.1]);
  map.setPaintProperty('app-fl-dist-line', 'line-color', css('--surface'));
  map.setPaintProperty('app-fl-dist-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, P.w === 1 ? 0.4 : 1, 15, 2.2]);
  const pts = R.DCODES.map(cd => { const o = P.w === 1 ? null : P.recs[cd]; return o && o.n ? {type: 'Feature', geometry: {type: 'Point', coordinates: R.DIST[cd].lab}, properties: {n: o.n}} : null; }).filter(Boolean);
  R.upsertSrc(map, 'app-fl-circ', {type: 'FeatureCollection', features: pts});
  R.addLayerOnce(map, {id: 'app-fl-circ', type: 'circle', source: 'app-fl-circ', maxzoom: 13.5, paint: {'circle-radius': ['*', 1.25, ['sqrt', ['get', 'n']]], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 1.4}});
  map.setPaintProperty('app-fl-circ', 'circle-stroke-color', css('--ink'));
  R.visL(map, 'app-fl-circ', !!S.p.flCirc && P.w !== 1);
  ringsAdd(H, 'app-flr-');
  ringsLoad(H, 'app-flr-', () => S.view === 'flips');
}
function radarDistTip(cd) {
  const C = cube(); if (!C) return null;
  const qi = qiSel(C), w = S.p.flW, h = S.p.flH;
  if (w === 1) {
    const z = R.DIST[cd].r5, o = rec(C, 'Z' + z, 1, qi, h);
    return tip(R.dname(cd), [['Zona', z], ['Flips da zona (1T)', o ? nf0.format(o.n) : '0'], ['Por 1.000 unid./ano (zona)', fRate(o && o.rate)], ['% dos negócios (zona)', fP(o && o.pneg)]], '1T: distrito tem n pequeno; a cor é a da zona · clique para abrir o distrito');
  }
  const o = rec(C, cd, w, qi, h), p = rec(C, cd, w, qi - 4, h);
  if (!o) return tip(R.dname(cd), [['Flips', '0']], 'sem flips na janela');
  const [g25, g50, g75] = gq(o);
  return tip(R.dname(cd), [
    [`Flips (${w}T, ≤ ${h} m)`, nf0.format(o.n) + (o.ok ? '' : ' (n baixo)') + (o.rel ? ` · ${o.rel} em < 3 m` : '')],
    ['Por 1.000 unid./ano', fRate(o.rate) + (p && p.rate != null && o.rate != null ? ` · Δ4T ${fD(o.rate - p.rate)}` : '')],
    ['% dos negócios · % das revendas', `${fP(o.pneg)} · ${fP(o.prev)}`],
    ['Holding mediano', fMes(o.h50)],
    [`Ganho ${GLB[S.p.flG]} bruto`, g50 != null ? `${fG(g50)} (IQR ${fG(g25)} a ${fG(g75)}) · n=${o.ng}` : '—'],
    ['Bate o CDI', fP(o.bate)], ['Estoque (IPTU)', o.est ? nf0.format(o.est) + ' unid.' : '—']],
    `${qSpan(o.q, w)} · clique para abrir o distrito`);
}
function wireRadar() {
  R.wireMap(MF, {layers: () => ['app-flr-hit'],
    tip: f => ringTip(f.properties), click: f => R.openLot(f.properties.cd, f.properties.id),
    hoverFallback: e => { if (MF.map.getZoom() >= 14) return null; const t = MF.hit(['app-fl-dist-fill'], e.point)[0]; return t ? radarDistTip(t.properties.cd) : null; },
    clickFallback: e => { const t = MF.hit(['app-fl-dist-fill'], e.point)[0]; if (t) R.openDist(t.properties.cd); }});
  MF.map.on('moveend', () => ringsLoad(MF, 'app-flr-', () => S.view === 'flips'));
}

/* ── funil de Spiegelhalter: x = estoque (log), y = taxa; limites 95% e 99,8% em torno da cidade ── */
function renderFunnel(C) {
  const c = R.chart('flFun'); if (!c) return;
  const qi = qiSel(C), w = S.p.flW, h = S.p.flH;
  if (w === 1) {
    c.clear();
    c.setOption(Object.assign(R.base(), {graphic: [{type: 'text', left: 'center', top: 'middle', style: {text: '1T: funil só com 4T ou 8T\n(o distrito tem mediana de ~6 flips por trimestre)', fill: css('--muted'), font: '13px "Hanken Grotesk", sans-serif', textAlign: 'center'}}]}), true);
    $('flFunSub').textContent = 'Com 1 trimestre não há n suficiente por distrito.'; $('flFunLeg').innerHTML = ''; return;
  }
  const city = rec(C, 'SP', w, qi, h);
  const K = 1000 * 4 / w, p0 = city && city.est ? city.n / city.est : null;
  const all = R.DCODES.map(cd => rec(C, cd, w, qi, h)).filter(o => o && o.est > 0);
  const pts = p0 ? all.filter(o => p0 * o.est >= 2) : [], fora = all.length - pts.length;   // < 2 flips esperados: o funil vira degrau
  if (!p0 || !pts.length) { c.clear(); return; }
  const ym = Math.max(...pts.map(o => o.rate || 0), p0 * K) * 1.15, yMax = ym > 3 ? Math.ceil(ym) : Math.ceil(ym * 2) / 2;
  const Ns = pts.map(o => o.est), lo = Math.min(...Ns) * 0.8, hi = Math.max(...Ns) * 1.25, grid = [];
  for (let i = 0; i <= 70; i++) grid.push(lo * Math.pow(hi / lo, i / 70));
  const lim = p => grid.map(N => [N, qpois(p, p0 * N) / N * K]);
  const cls = o => { const mu = p0 * o.est; return o.n > qpois(0.999, mu) ? 2 : o.n > qpois(0.975, mu) ? 1 : o.n < qpois(0.001, mu) ? -2 : o.n < qpois(0.025, mu) ? -1 : 0; };
  const ink = css('--ink'), mut = css('--muted'), lab = [];
  const data = pts.map(o => { const k = cls(o); if (k) lab.push(o.reg); return {value: [o.est, o.rate], cd: o.reg, k, n: o.n,
    symbol: 'circle', symbolSize: Math.abs(k) === 2 ? 10 : Math.abs(k) === 1 ? 8 : 6,
    itemStyle: k > 0 ? {color: ink, borderColor: css('--surface'), borderWidth: 1} : k < 0 ? {color: 'transparent', borderColor: ink, borderWidth: 1.4} : {color: mut, opacity: o.ok ? 0.55 : 0.3},
    label: {show: k !== 0, formatter: R.dname(o.reg), position: 'right', fontSize: 10, color: css('--ink-2')}}; });
  const ln = (d, name, type, op) => ({name, type: 'line', data: d, symbol: 'none', silent: true, lineStyle: {color: css('--ink-2'), width: 1, type, opacity: op}, z: 1});
  c.setOption(Object.assign(R.base(), {
    grid: {left: 52, right: 74, top: 14, bottom: 44},
    xAxis: R.ax({type: 'log', name: 'estoque do segmento (unid., IPTU; log)', nameLocation: 'middle', nameGap: 26, min: lo, max: hi, axisLabel: {color: mut, fontSize: 10, formatter: v => v >= 1000 ? nf0.format(v / 1000) + ' mil' : nf0.format(v)}}),
    yAxis: R.ax({type: 'value', name: 'flips por 1.000 unid./ano', nameLocation: 'middle', nameGap: 36, min: 0, max: yMax, axisLabel: {color: mut, fontSize: 10, formatter: v => nf1.format(v)}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { if (!p.data || !p.data.cd) return ''; const o = rec(C, p.data.cd, w, qi, h), mu = p0 * o.est;
      return tip(R.dname(o.reg), [['Flips', `${nf0.format(o.n)} (esperado ${nf1.format(mu)} na taxa da cidade)`], ['Por 1.000 unid./ano', fRate(o.rate)], ['Estoque', nf0.format(o.est) + ' unid.'],
        ['Limites 95%', `${nf0.format(qpois(0.025, mu))}–${nf0.format(qpois(0.975, mu))} flips`], ['Leitura', ['frio de verdade (fora de 99,8%)', 'abaixo do esperado (fora de 95%)', 'dentro do funil: ruído', 'acima do esperado (fora de 95%)', 'quente de verdade (fora de 99,8%)'][p.data.k + 2]]], 'clique para abrir o distrito'); }}),
    series: [ln(lim(0.975), '95%', 'dashed', 0.9), ln(lim(0.025), '95% inf', 'dashed', 0.9), ln(lim(0.999), '99,8%', 'dotted', 0.8), ln(lim(0.001), '99,8% inf', 'dotted', 0.8),
      {name: 'cidade', type: 'line', data: [[lo, p0 * K], [hi, p0 * K]], symbol: 'none', silent: true, lineStyle: {color: ink, width: 1.2}, z: 1,
        endLabel: {show: true, formatter: 'cidade ' + nf2.format(p0 * K), color: css('--ink-2'), fontSize: 10}},
      {name: 'distritos', type: 'scatter', data, z: 3, labelLayout: {hideOverlap: true}}],
  }), true);
  c.off('click'); c.on('click', p => { if (p.data && p.data.cd) R.openDist(p.data.cd); });
  const nk = k => data.filter(d => d.k === k).length;
  $('flFunSub').textContent = `${qSpan(C.q[qi], w)} · ${pts.length} distritos · taxa da cidade ${nf2.format(p0 * K)} por 1.000/ano. Fora do funil = diferença que não se explica pelo tamanho do estoque. Rótulo só fora do funil.${fora ? ` ${fora} distrito(s) com menos de 2 flips esperados ficam de fora (estoque pequeno do segmento).` : ''}`;
  $('flFunLeg').innerHTML = `<span class="it"><i class="dot" style="background:var(--ink)"></i>acima (${nk(1) + nk(2)}; ${nk(2)} fora de 99,8%)</span><span class="it"><i class="dot" style="box-shadow:inset 0 0 0 1.4px var(--ink)"></i>abaixo (${nk(-1) + nk(-2)})</span>` +
    `<span class="it"><i class="dot" style="background:var(--muted);opacity:.6"></i>dentro: ruído</span><span class="it"><i class="lk fl-lk dash"></i>95%</span><span class="it"><i class="lk fl-lk dot2"></i>99,8%</span>`;
}

/* ── série trimestral empilhada por faixa de holding + % das revendas (gráfico próprio, alinhado) ── */
function serOf(SR, reg, cam) {
  const pick = r => { const x = SR.r[r]; if (!x) return null; return cam === 'todas' ? x.madura.map((a, i) => a.map((v, j) => v + x.lancamento[i][j])) : x[cam]; };
  if (reg === 'SP' || isDist(reg)) return pick(reg);
  const cds = R.DCODES.filter(cd => 'Z' + R.DIST[cd].r5 === reg); let acc = null;
  cds.forEach(cd => { const a = pick(cd); if (!a) return; acc = acc ? acc.map((s, i) => s.map((v, j) => v + a[i][j])) : a.map(s => s.slice()); });
  return acc;
}
function renderSerie(C, M) {
  const SR = get(`serie_${seg()}.json`); const c1 = R.chart('flSer'), c2 = R.chart('flSerP'); if (!c1 || !c2) return;
  if (!SR) { $('flSerSub').textContent = offline() || 'Carregando a série…'; return; }
  const reg = S.p.flR, cam = S.p.flC, h = S.p.flH, a = serOf(SR, reg, cam); if (!a) return;
  const q0 = qnum(SR.q0), i0 = 4, X = a[0].map((_, i) => qlab(q0 + i)).slice(i0);   // desde 2007 (12 meses de histórico)
  const [rel, f312, f1224, rev, neg] = a.map(s => s.slice(i0));
  const col = bandCols(), qEnd = C.q[qiSel(C)], jEnd = X.indexOf(qEnd), jIni = jEnd - S.p.flW + 1;
  const pct = X.map((_, j) => { let n = 0, d = 0; for (let k = Math.max(0, j - 3); k <= j; k++) { n += rel[k] + f312[k] + (h === 24 ? f1224[k] : 0); d += rev[k]; } return d >= 20 ? 100 * n / d : null; });
  const i16 = X.indexOf('1T2016'), pMax = Math.ceil(Math.max(5, ...pct.filter((v, j) => j >= i16 && v != null)) * 1.6 / 5) * 5;
  const axis = {type: 'category', data: X, axisLabel: {color: css('--muted'), fontSize: 10, interval: i => /^1T/.test(X[i]) && (+X[i].slice(-4)) % 2 === 1, formatter: v => v.slice(-4)}};
  const grid = {left: 52, right: 14, top: 10, bottom: 22};
  const tipF = ps => { const j = ps[0].dataIndex, fl = rel[j] + f312[j] + (h === 24 ? f1224[j] : 0);
    return tip(`${X[j]} · ${regName(reg)}`, [['3–12 m (flip típico)', nf0.format(f312[j]), col.f312], ['< 3 m (relâmpago)', nf0.format(rel[j]), col.rel], ...(h === 24 ? [['12–24 m (revenda rápida)', nf0.format(f1224[j]), col.f1224]] : []),
      ['Revendas válidas', nf0.format(rev[j])], ['% das revendas (4T móveis)', fP(pct[j])], ['% dos negócios de unidade pronta', neg[j] ? fP(100 * fl / neg[j]) : '—']], `${TLB[seg()]} · ${CAM[cam][0]}${j < i16 ? ' · antes de 2016 a % das revendas fica inflada (cadeias começam em 2006)' : ''}`); };
  c1.setOption(Object.assign(R.base(), {grid, xAxis: R.ax(Object.assign({}, axis, {axisLabel: Object.assign({}, axis.axisLabel, {show: false})})),
    yAxis: R.ax({type: 'value', name: 'flips/trim.', nameTextStyle: {fontSize: 10, color: css('--muted')}, axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf0.format(v)}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: tipF}),
    series: [{name: 'janela', type: 'line', data: X.map(() => null), silent: true, symbol: 'none', z: 0,   // markArea numa série de linha (na de barras sai deslocada)
      markArea: jEnd >= 0 ? {silent: true, itemStyle: {color: css('--accent-wash')}, data: [[{xAxis: X[Math.max(0, jIni)]}, {xAxis: X[jEnd]}]]} : undefined},
      {name: '3–12 m', type: 'bar', stack: 'f', data: f312, itemStyle: {color: col.f312}, barCategoryGap: '18%'},
      {name: '< 3 m', type: 'bar', stack: 'f', data: rel, itemStyle: {color: col.rel, decal: HATCH}},
      ...(h === 24 ? [{name: '12–24 m', type: 'bar', stack: 'f', data: f1224, itemStyle: {color: col.f1224}}] : [])],
    aria: {enabled: true, decal: {show: false}}}), true);
  c2.setOption(Object.assign(R.base(), {grid: {left: 52, right: 14, top: 8, bottom: 26}, xAxis: R.ax(axis),
    yAxis: R.ax({type: 'value', name: '% revendas', min: 0, max: pMax, nameTextStyle: {fontSize: 10, color: css('--muted')}, axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf0.format(v) + '%'}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: tipF}),
    series: [{name: 'antes de 2016', type: 'line', data: pct.map((v, j) => j <= i16 ? v : null), symbol: 'none', lineStyle: {color: css('--muted'), width: 1.4, type: 'dashed'}, itemStyle: {color: css('--muted')}},
      {name: '% das revendas', type: 'line', data: pct.map((v, j) => j >= i16 ? v : null), symbol: 'none', lineStyle: {color: css('--ink'), width: 1.8}, itemStyle: {color: css('--ink')},
        markArea: jEnd >= 0 ? {silent: true, itemStyle: {color: css('--accent-wash')}, data: [[{xAxis: X[Math.max(0, jIni)]}, {xAxis: X[jEnd]}]]} : undefined}]}), true);
  $('flSerT').textContent = `Flips por trimestre · ${regName(reg)}`;
  $('flSerSub').textContent = `${TLB[seg()]} · ${CAM[cam][0]} · barras empilhadas por faixa de holding; abaixo, no mesmo eixo de tempo, a % das revendas que são flips (4 trimestres móveis). Faixa sombreada = janela selecionada. Série completa desde 2007 (precisa de 12 meses de histórico).`;
  $('flSerLeg').innerHTML = `<span class="it"><i class="dot" style="border-radius:2px;background:${col.f312}"></i>3–12 m (flip típico)</span><span class="it"><i class="dot fl-hatch" style="border-radius:2px;background-color:${col.rel}"></i>&lt; 3 m (relâmpago: maior risco de artefato)</span>` +
    (h === 24 ? `<span class="it"><i class="dot" style="border-radius:2px;background:${col.f1224}"></i>12–24 m (revenda rápida)</span>` : '') +
    `<span class="it"><i class="lk" style="background:var(--ink)"></i>% das revendas</span><span class="it"><i class="lk fl-lk dash"></i>antes de 2016: inflada (as cadeias começam em 2006; o topo fica cortado)</span>`;
}

/* ── distribuição do ganho por faixa de holding (cidade): p10–p90, IQR partido no zero (perda em vermelho) ── */
function renderDist(C, M) {
  const DS = get('dist.json'), c = R.chart('flDist'); if (!c) return;
  const mode = S.p.flA, g = S.p.flG;
  $('flDistCtrl').innerHTML = `<span class="lab">Medida</span>${segBtns('flA', [['aa', 'real anualizado', 'Ganho real (IPCA) ao ano: só holding ≥ 6 meses (abaixo disso a anualização explode)'], ['per', `${GLB[g]} no período`, 'Segue o seletor de ganho do topo']], mode)}`;
  if (!DS) { $('flDistSub').textContent = offline() || 'Carregando…'; return; }
  const key = `${seg()}|${S.p.flC}|${S.p.flW}`, qEnd = C.q[qiSel(C)], j = DS.q.indexOf(qEnd), rows = DS.t[key] && DS.t[key][j];
  if (!rows) { c.clear(); return; }
  const kIdx = mode === 'aa' ? 6 : g === 'nom' ? 3 : g === 'cdi' ? 4 : g === 'mkt' ? 7 : 2;
  const B = DS.b.map((b, i) => { const r = rows[i], qv = r[kIdx], n = mode === 'aa' ? r[5] : r[0]; return {b, n, perda: r[1], q: qv && qv[2] != null && n >= 5 ? qv : null}; });
  const vals = B.filter(x => x.q).flatMap(x => [x.q[0], x.q[4]]);
  const span = Math.max(10, ...vals) - Math.min(0, ...vals, -5), step = [5, 10, 20, 25, 50, 100].find(v => span / v <= 7) || 200;
  const xmin = Math.floor(Math.min(0, ...vals, -5) / step) * step, xmax = Math.ceil(Math.max(10, ...vals) / step) * step;
  const good = css('--good'), bad = css('--crit'), ink = css('--ink');
  c.setOption(Object.assign(R.base(), {
    grid: {left: 70, right: 96, top: 8, bottom: 30},
    xAxis: R.ax({type: 'value', min: xmin, max: xmax, interval: step, axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf0.format(v) + '%'}}),
    yAxis: R.ax({type: 'category', data: B.map(x => x.b), inverse: true, splitLine: {show: false}, axisLabel: {color: css('--ink-2'), fontSize: 11}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { const x = B[p.dataIndex]; if (!x) return '';
      return tip(`Holding ${x.b} · ${mode === 'aa' ? 'real anualizado' : GLB[g] + ' no período'}`, x.q ? [['Mediana', fG(x.q[2])], ['IQR (p25–p75)', `${fG(x.q[1])} a ${fG(x.q[3])}`], ['p10–p90', `${fG(x.q[0])} a ${fG(x.q[4])}`], ['Com perda real', fP(x.perda)], ['n (com ganho calculável)', nf0.format(x.n)]] : [['', mode === 'aa' && x.b.includes('3') && !x.b.includes('12') ? 'sem anualização abaixo de 6 m' : 'n insuficiente']], 'ganho bruto declarado: sem reforma, IR e custos'); }}),
    series: [{type: 'custom', data: B.map((x, i) => [i]), renderItem: (params, api) => {
      const x = B[api.value(0)], y = api.coord([0, api.value(0)])[1], bh = 14;
      if (!x.q) { const p = api.coord([0, api.value(0)]); return {type: 'text', style: {text: mode === 'aa' && !/6–12|12–24/.test(x.b) ? 'anualização só com holding ≥ 6 m' : 'n insuficiente', x: p[0] + 6, y, fill: css('--muted'), font: '11px "Hanken Grotesk", sans-serif', verticalAlign: 'middle'}}; }
      const X = v => api.coord([v, api.value(0)])[0], z = X(0);
      const kids = [{type: 'line', shape: {x1: X(x.q[0]), y1: y, x2: X(x.q[4]), y2: y}, style: {stroke: css('--ink-2'), lineWidth: 1}}];
      const a = X(x.q[1]), b = X(x.q[3]);
      if (a < z) kids.push({type: 'rect', shape: {x: a, y: y - bh / 2, width: Math.min(b, z) - a, height: bh}, style: {fill: bad, opacity: 0.55}});
      if (b > z) kids.push({type: 'rect', shape: {x: Math.max(a, z), y: y - bh / 2, width: b - Math.max(a, z), height: bh}, style: {fill: good, opacity: 0.45}});
      kids.push({type: 'rect', shape: {x: X(x.q[2]) - 1.5, y: y - bh / 2 - 3, width: 3, height: bh + 6}, style: {fill: ink}});
      kids.push({type: 'text', style: {text: `${fG(x.q[2])} · n=${nf0.format(x.n)}`, x: params.coordSys.x + params.coordSys.width + 6, y, fill: css('--ink-2'), font: '11px "Hanken Grotesk", sans-serif', verticalAlign: 'middle'}});
      return {type: 'group', children: kids};
    }, z: 3},
    {type: 'line', data: [], markLine: {silent: true, symbol: 'none', lineStyle: {color: ink, width: 1}, label: {show: false}, data: [{xAxis: 0}]}}],
  }), true);
  $('flDistSub').textContent = `Flips e revendas rápidas com ganho calculável · ${TLB[seg()]} · ${CAM[S.p.flC][0]} · ${qSpan(qEnd, S.p.flW)} · cidade (por distrito o n não sustenta a distribuição).`;
  $('flDistLeg').innerHTML = `<span class="it"><i class="fl-bx neg"></i>parte do IQR com perda</span><span class="it"><i class="fl-bx pos"></i>com ganho</span><span class="it"><i class="lk" style="background:var(--ink);width:3px;height:12px"></i>mediana</span><span class="it muted">traço fino = p10–p90 · bruto declarado</span>`;
}
$('flDistCtrl').addEventListener('click', e => { const b = e.target.closest('.seg[data-k] button'); if (b) { S.p.flA = b.dataset.v; R.render(); } });

/* ── comprou na planta → revendeu (cidade) + cobertura da ponte ── */
function renderPlanta(M) {
  const PJ = get('planta.json'); if (!PJ) { $('flPl').innerHTML = `<p class="sub">${offline() || 'Carregando…'}</p>`; return; }
  const c = PJ.cidade, p8 = M.p_a2_8 || {}, lanc = (M.cubo_cidade_8T || {})[seg() + '_lancamento'] || {}, mad = (M.cubo_cidade_8T || {})[seg() + '_madura'] || {};
  const pon = PJ.ponte.filter(x => x.ano >= 2010), mx = Math.max(...pon.map(x => x.pct));
  const saf = PJ.safra.filter(r => r[0] >= 2016);
  $('flPl').innerHTML = `<div class="kpis fl-kpis2">${[
    kpi('Revendas de quem comprou na planta', nf0.format(c.n_pl), `${nf0.format(c.n_pl12)} em ≤ 12 m desde a planta · 2006–2026`),
    kpi('Holding desde a planta', fMes(c.h50), `IQR ${nf1.format(c.h25)}–${nf1.format(c.h75)} m · flips: ${fMes(c.h50_12)}`),
    kpi('Ganho real bruto', fG(c.r50), `IQR ${fG(c.r25)} a ${fG(c.r75)} · n=${nf0.format(c.ng)} · flips ≤ 12 m ${fG(c.r50_12)} (n=${c.ng12})`),
    kpi('Líquido de custos (real)', fG(liq(c.r50)), `bate o CDI: ${fP(c.bate)} · preço da planta sem INCC`),
  ].join('')}</div>` +
    `<p class="note">Prédios de até 3 anos concentram as revendas curtas: na camada lançamento (${TLB[seg()].toLowerCase()}, 8T até ${lastQ()}), <b>${fP(lanc.pct_rev)}</b> das revendas são flips (madura: ${fP(mad.pct_rev)}); taxa de ${fRate(lanc.rate)} contra ${fRate(mad.rate)} por 1.000 unid./ano.</p>` +
    `<div class="fl-two"><div><h4 class="fl-h4">Por safra da planta (≥ 5 revendas)</h4><table class="t fl-mini"><thead><tr><th>Safra</th><th class="n">Revendas</th><th class="n">Holding</th><th class="n">Ganho real</th></tr></thead><tbody>${
      saf.map(r => `<tr><td>${r[0]}</td><td class="n">${nf0.format(r[1])}</td><td class="n">${fMes(r[2])}</td><td class="n">${dot(r[4])}${fG(r[4])} <small class="muted">n=${r[3]}</small></td></tr>`).join('')}</tbody></table></div>` +
    `<div><h4 class="fl-h4">Cobertura da ponte planta → unidade</h4><div class="fl-cov">${pon.map(x => `<div class="fl-covr${x.ano >= 2021 && x.ano <= 2023 ? ' hi' : ''}"><span>${x.ano}</span><i style="width:${Math.max(2, x.pct / mx * 100)}%"></i><b>${nf0.format(x.pct)}%</b></div>`).join('')}</div>` +
    `<p class="note">Só entram as unidades cuja guia da planta foi ligada ao SQL individualizado: <b>26–30% das safras 2021–23</b>, menos de 7% das de 2025–26 (prédios ainda não individualizados).</p></div></div>` +
    `<p class="fl-warn">Registro em duas etapas (P-A2-8): guia da planta seguida da 1ª guia do SQL da mesma unidade em ≤ 12 m, com valor 0,85–1,15× — é a mesma compra registrada duas vezes, não revenda. <b>${nf0.format(p8.pares_2e || 0)}</b> pares colapsados (${nf0.format(p8.flips_2e || 0)} eram flips); na camada lançamento de apartamentos, 8T: ${nf0.format(p8.apto_lanc8_a2 || 0)} → <b>${nf0.format(p8.apto_lanc8_pos || 0)}</b> flips (inclui ${nf0.format(p8.flips_art_pl || 0)} colisões "SQL próprio → planta" fora). Com crédito associativo não há guia nas chaves: a "1ª venda" já é revenda.</p>`;
}

/* ── rankings: prédios (Wilson), ruas, tipologias (mapa de calor faixa × trimestre) ── */
function renderRank(C, M) {
  const t = S.p.flT;
  $('flTabs').innerHTML = [['predios', 'Prédios'], ['ruas', 'Ruas'], ['tip', 'Tipologias']].map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${t === k}">${l}</button>`).join('');
  $('flTipo').innerHTML = ''; $('flRk').innerHTML = ''; $('flRk').hidden = t === 'tip';
  if (t === 'tip') return renderTipo(M);
  const J = S.p.flJ, h = S.p.flH, cam = S.p.flC, sg = seg(), R8 = M.regras;
  $('flRkCtl').innerHTML = `<span class="lab">Janela</span>${segBtns('flJ', [[8, '8T'], [20, '20T']], J)}<span class="muted" style="font-size:12px">até ${lastQ()} · ${TLB[sg].toLowerCase()} · ${esc(CAM[cam][0])} · holding ≤ ${h} m · ordenado pelo limite inferior de Wilson da taxa</span>`;
  const D = get(t === 'ruas' ? 'ruas.json' : 'predios.json');
  if (!D) { $('flRkSub').textContent = offline() || 'Carregando…'; return; }
  const all = D.t[`${sg}|${cam}|${J}|${h}`] || [];
  const nmin = t === 'ruas' ? (J === 8 ? R8.rua_n : 20) : (J === 8 ? R8.predio_n8 : R8.predio_n20);
  const rows = all.filter(r => r.n >= nmin && (t === 'ruas' ? (r.est || 0) >= R8.rua_est : (r.est || 0) >= 20) && r.lb != null).sort((a, b) => b.lb - a.lb).slice(0, 80);
  const gcol = {k: 'r50', label: 'Ganho real bruto', n: 1, sv: r => r.r50, f: r => r.r50 != null ? `${dot(r.r50)}${fG(r.r50)} <span class="ci">[${nf0.format(r.r25)}; ${nf0.format(r.r75)}] n=${r.ng}</span>` : `<span class="gray">n=${r.ng}</span>`};
  const rate = {k: 'lb', label: 'Taxa · Wilson inf.', n: 1, title: 'flips por 1.000 unidades por ano; ordenado pelo limite inferior do IC95% de Wilson', sv: r => r.lb, f: r => `${fRate(r.rate)} <span class="ci">≥ ${fRate(r.lb)}</span>`};
  if (t === 'predios') {
    $('flRkSub').textContent = `${rows.length} prédios (condomínios com ≥ 20 unidades do segmento) com n ≥ ${nmin} flips em ${J}T, de ${all.length} com 3 ou mais. Unid. = unidades do segmento no IPTU 2026; taxa = flips por 1.000 unidades por ano, com o limite inferior do IC95% de Wilson (a ordem). Clique para abrir o prédio.`;
    R.table($('flRk'), 'flpred', [
      {k: 'end', label: 'Prédio', cls: 'wrap', sv: r => r.end, f: r => `<button class="linkbtn" type="button">${esc(r.end || r.k)}</button><div class="qtag" style="margin:0">${r.acc ? 'ACC ' + r.acc : ''}${r.padrao ? ' · padrão ' + esc(r.padrao) : ''}${r.pav ? ' · ' + r.pav + ' pav.' : ''}</div>`},
      {k: 'cd', label: 'Distrito', sv: r => R.dname(r.cd), f: r => esc(R.dname(r.cd))},
      {k: 'est', label: 'Unid.', n: 1, f: r => r.est != null ? nf0.format(r.est) : '—'},
      {k: 'n', label: 'Flips', n: 1, f: r => `${nf0.format(r.n)}${r.rel ? ` <span class="ci">${r.rel} &lt;3m</span>` : ''}`},
      rate, {k: 'hmed', label: 'Holding', n: 1, f: r => fMes(r.hmed)}, gcol,
      {k: 'bate', label: '> CDI', n: 1, f: r => fP(r.bate)},
    ], rows, {sort: null, onRow: r => R.openLot(r.cd, r.k)});
  } else {
    $('flRkSub').textContent = `${rows.length} ruas com n ≥ ${nmin} flips em ${J}T e estoque ≥ ${R8.rua_est} unidades (código de logradouro do IPTU). Clique para abrir o distrito.`;
    R.table($('flRk'), 'flruas', [
      {k: 'nome', label: 'Rua', cls: 'wrap', sv: r => r.nome, f: r => `<button class="linkbtn" type="button">${esc(r.nome || r.k)}</button>`},
      {k: 'cd', label: 'Distrito', sv: r => R.dname(r.cd), f: r => esc(R.dname(r.cd))},
      {k: 'est', label: 'Estoque', n: 1, f: r => r.est != null ? nf0.format(r.est) : '—'},
      {k: 'n', label: 'Flips', n: 1, f: r => `${nf0.format(r.n)}${r.rel ? ` <span class="ci">${r.rel} &lt;3m</span>` : ''}`},
      rate, {k: 'pn', label: '% negócios', n: 1, sv: r => r.neg ? r.n / r.neg : null, f: r => r.neg ? fP(100 * r.n / r.neg) : '—'},
      {k: 'hmed', label: 'Holding', n: 1, f: r => fMes(r.hmed)}, gcol,
    ], rows, {sort: null, onRow: r => R.openDist(r.cd)});
  }
}
$('flTabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) { S.p.flT = b.dataset.t; R.render(); } });
$('flRkCtl').addEventListener('click', e => { const b = e.target.closest('.seg[data-k] button'); if (b) { S.p.flJ = +b.dataset.v; R.render(); } });
function renderTipo(M) {
  const T = get('tipologia.json'); $('flRkCtl').innerHTML = '';
  if (!T) { $('flRkSub').textContent = offline() || 'Carregando…'; return; }
  const sg = seg(), dim = sg !== 'apto' && S.dim === 'quartos' ? 'area' : S.dim, fx = T.dims[dim], h = S.p.flH;
  const cell = T.t[`${sg}|${S.p.flC}|${h}|${dim}`]; if (!cell) { $('flRkSub').textContent = 'Sem dados.'; return; }
  const lbl = f => (R.FXLB[dim] && R.FXLB[dim][f]) || f;
  $('flRkSub').innerHTML = `% de flips nos negócios de unidade pronta, por <b>${esc(R.DIMLB[dim] || dim)}</b> (seletor do topo) × trimestre, cidade · ${TLB[sg].toLowerCase()} · ${esc(CAM[S.p.flC][0])} · holding ≤ ${h} m. Número na célula = flips; cinza = n &lt; ${NMIN}. A faixa escolhida no topo fica em destaque.`;
  const vals = [];
  cell.c.forEach((row, i) => row.forEach((c, j) => { if (c[0] >= NMIN && c[1]) vals.push(100 * c[0] / c[1]); }));
  const lo = R.qt(vals, 0.05) || 0, hi = R.qt(vals, 0.95) || 5, st = R.PALS.seq();
  const colr = v => R.ramp(st, clamp((v - lo) / ((hi - lo) || 1), 0, 1));
  const txt = v => R.ramp(st, clamp((v - lo) / ((hi - lo) || 1), 0, 1));
  const lumi = hex => { const m = hex.match(/\w\w/g).map(x => parseInt(x, 16)); return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; };
  const head = `<tr><th>${esc(R.DIMLB[dim] || dim)}</th>${T.q.map(q => `<th class="n">${q}</th>`).join('')}<th class="n" title="8 trimestres">8T</th><th class="n">% revendas</th><th class="n">Holding</th><th class="n">Ganho real bruto</th></tr>`;
  const body = fx.map((f, i) => {
    const tt = cell.tot[i], sel = S.fx === f;
    const tds = cell.c[i].map((c, j) => { const ok = c[0] >= NMIN && c[1], v = c[1] ? 100 * c[0] / c[1] : null;
      if (!ok) return `<td class="n fl-hm gcell" title="${T.q[j]} · ${esc(lbl(f))}: ${c[0]} flips em ${c[1]} negócios (n baixo)"><span>${v != null ? nf1.format(v) : '—'}</span><small>${c[0]}</small></td>`;
      const bg = colr(v), dark = lumi(bg) < 0.55;
      return `<td class="n fl-hm" style="background:${bg};color:${dark ? '#fff' : '#0b0b0b'}" title="${T.q[j]} · ${esc(lbl(f))}: ${c[0]} flips em ${c[1]} negócios (${c[2]} em < 3 m)"><span>${nf1.format(v)}</span><small>${c[0]}</small></td>`; }).join('');
    const p8 = tt[1] ? 100 * tt[0] / tt[1] : null;
    return `<tr class="${sel ? 'sel' : ''}"><td>${esc(lbl(f))}</td>${tds}<td class="n"><b>${fP(p8)}</b> <small class="muted">${tt[0]}</small></td><td class="n">${tt[2] ? fP(100 * tt[0] / tt[2]) : '—'}</td><td class="n">${fMes(tt[7])}</td><td class="n">${tt[5] != null ? `${dot(tt[5])}${fG(tt[5])} <span class="ci">n=${tt[3]}</span>` : '—'}</td></tr>`;
  }).join('');
  $('flTipo').innerHTML = `<div class="tablewrap"><table class="t fl-hmt"><thead>${head}</thead><tbody>${body}</tbody></table></div>` +
    `<div class="legend"><span class="scale">% de flips nos negócios ${nf1.format(lo)}%<span class="g" style="background:${R.gradCss(st)}"></span>${nf1.format(hi)}%</span><span class="it"><i class="dot gcell" style="border-radius:2px;background:var(--gray-cell)"></i>n &lt; ${NMIN} flips</span><span class="it muted">faixas: ${dim === 'area' ? 'área construída do IPTU na venda' : dim === 'idade' ? 'idade do prédio na venda' : dim === 'quartos' ? 'quartos estimados pelos anúncios' : 'padrão construtivo do IPTU'}</span></div>`;
  void txt;
}

/* ── notas fixas ───────────────────────────────────────── */
function renderNotes(M) {
  const hz = M.hazard || [];
  $('flNotes').innerHTML = `<h3>Como ler (e o que não dá para dizer)</h3><div class="fl-notes-g"><ol>
    <li><b>Ganho declarado não é TIR.</b> É a diferença entre os valores das duas guias: sem reforma, IR (15% sobre o ganho de capital), condomínio, IPTU e juros. O líquido usa premissas fixas: entrada +4,5% (ITBI 3% + cartório 1,5%) e saída −6% (corretagem).</li>
    <li><b>Compra ÷ VVR.</b> Quem revende rápido declara a compra, na mediana, a ~1,00× o valor venal de referência (o piso fiscal) e a venda a ~1,4×, em geral com financiamento. É compra com desconto (venda urgente, espólio, leilão) e/ou subdeclaração na compra; os dados não separam. Por isso o ganho é “margem declarada”.</li>
    <li><b>Sem comprador nem vendedor no ITBI.</b> Flip aqui é a revenda rápida da unidade, não a identidade de um investidor. Só ~28% das revendas em até 12 meses estão acima do giro normal (risco de base de 0,24% ao mês, plano desde o mês 12); o resto é revenda precoce comum (mudança, separação).</li>
    <li><b>Por que 12 meses.</b> O excesso de risco de revenda termina em ~11 meses (gráfico ao lado); entre 12 e 24 meses a revenda não se distingue do giro normal. Menos de 3 meses (relâmpago) concentra artefatos de registro: sempre à parte.</li>
    <li><b>Acima do mercado (alfa, P-A2-12).</b> Ganho nominal descontada a variação do índice TTM de R$/m² do distrito × tipo entre a compra e a venda (cidade × tipo quando o distrito tem n &lt; 10).${M.alfa ? ` Nos flips de apartamento maduro (8T), o índice andou <b>${fG(M.alfa.merc_med)}</b> na mediana e o ganho nominal foi ${fG(M.alfa.nom_med)}: alfa de <b>${fG(M.alfa.alfa_med)}</b>. O ganho do flip não vem da alta do mercado; vem do preço de entrada (e do que o ITBI não vê).` : ''}</li>
    <li><b>Planta.</b> A ponte planta → unidade cobre 26–30% das safras 2021–23. Registro em duas etapas colapsado (P-A2-8); planta → planta é repasse e fica fora; o preço da planta não tem a correção do INCC nem o parcelamento.</li>
    <li><b>Séries.</b> Flips só a partir de 2007 (12 meses de histórico); a % das revendas só vale a partir de ~2016 (as cadeias começam em 2006). Casas têm SQL menos estável: cadeias de casas que viraram terreno de incorporação somem. Estoque: IPTU de 2010, 2015, 2020–23, 2025 e 2026 (2024 usa 2025).</li>
  </ol><div><h4 class="fl-h4">Excesso de risco de revenda sobre a base, por mês de holding (compras 2008–22)</h4><div id="flHz" class="chart" style="height:170px"></div></div></div>
  <p class="note">Fonte: ${esc(M.fonte)} Agregados: proto/build_flips.py.</p>`;
  const c = R.chart('flHz'); if (!c || !hz.length) return;
  c.setOption(Object.assign(R.base(), {grid: {left: 44, right: 10, top: 18, bottom: 26},
    xAxis: R.ax({type: 'category', data: hz.map(x => x[0]), axisLabel: {color: css('--muted'), fontSize: 10, interval: 5, formatter: v => v + ' m'}}),
    yAxis: R.ax({type: 'value', axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf2.format(v) + '%'}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: ps => { const x = hz[ps[0].dataIndex]; return tip(`Mês ${x[0]} de holding`, [['Risco de revenda no mês', nf2.format(x[1]) + '%'], ['Excesso sobre a base (0,24%)', (x[2] >= 0 ? '+' : '−') + nf2.format(Math.abs(x[2])) + ' p.p.']]); }}),
    series: [{type: 'bar', data: hz.map(x => ({value: x[2], itemStyle: {color: x[0] < 12 ? R.RAMP[R.mode()].seq[5] : css('--axis')}})), barCategoryGap: '25%',
      markLine: {silent: true, symbol: 'none', lineStyle: {color: css('--ink-2'), type: 'dashed'}, label: {formatter: '12 m', color: css('--ink-2'), fontSize: 10}, data: [{xAxis: 12}]}}]}), true);
}

/* ════════ SEÇÃO · DISTRITO ═══════════════════════════════ */
R.registerSection('distrito', {id: 'flips', title: 'Flips no distrito', order: 30,
  sub: 'A mesma unidade revendida em até 12 meses · estoque maduro (prédio > 3 anos) · ganho bruto declarado (sem reforma nem IR)',
  render(el, ctx) {
    const cd = ctx.cd, sg = seg();
    freshChart(el);
    el.innerHTML = '<div class="loading">Carregando flips…</div>';
    Promise.all([loadP('meta.json'), loadP(`d/${sg}_madura.json`), loadP(`serie_${sg}.json`), loadP('ruas.json'), loadP('predios.json')]).then(([M, C, SR, RU, PR]) => {
      if (S.view !== 'distrito' || S.cd !== cd) return;
      const qi = C.q.length - 1, o = rec(C, cd, 8, qi, 12), p = rec(C, cd, 8, qi - 4, 12), sp = rec(C, 'SP', 8, qi, 12);
      if (!o) { el.innerHTML = `<p class="sub">Sem flips de ${TLB[sg].toLowerCase()} no distrito em 8T.</p>`; return; }
      const k = o.est ? 1000 * 4 / 8 / o.est : null, ci = poisCI(o.n);
      const top = (D, n0, extra) => (D.t[`${sg}|madura|8|12`] || []).filter(r => r.cd === cd && extra(r)).sort((a, b) => (b.lb || 0) - (a.lb || 0)).slice(0, 6);
      const tp = top(PR, 3, () => true), tr = top(RU, 3, r => (r.est || 0) >= 100);
      const li = (r, lab, onc) => `<li><button type="button" class="linkbtn" ${onc}>${esc(lab)}</button> <span class="${r.n >= (onc.includes('lot') ? M.regras.predio_n8 : M.regras.rua_n) ? '' : 'gray'}">${r.n} flips · ${fRate(r.rate)}/1.000/ano (Wilson ≥ ${fRate(r.lb)}) · holding ${fMes(r.hmed)} · ganho ${fG(r.r50)} n=${r.ng}</span></li>`;
      el.innerHTML = `<div class="kpis">${[
        kpi('Flips 8T', gray(nf0.format(o.n), !o.ok), `${nf0.format(o.rel || 0)} em &lt; 3 m · ${qSpan(o.q, 8)}`),
        kpi('Por 1.000 unid./ano', gray(fRate(o.rate), !o.ok), `IC ${fRate(ci[0] * k)}–${fRate(ci[1] * k)} · cidade ${fRate(sp && sp.rate)}`),
        kpi('Δ taxa vs 4T antes', p && p.rate != null ? fD(o.rate - p.rate) : '—', p ? `era ${fRate(p.rate)} (n=${p.n})` : ''),
        kpi('% dos negócios', gray(fP(o.pneg), !o.ok), `cidade ${fP(sp && sp.pneg)} · ${fP(o.prev)} das revendas`),
        kpi('Holding mediano', gray(fMes(o.h50), !o.ok), o.h50 != null ? `IQR ${nf1.format(o.h25)}–${nf1.format(o.h75)} m` : ''),
        kpi(ganhoLb('Ganho real bruto'), gray(fG(o.r50), o.ng < NMIN), o.r50 != null ? `IQR ${fG(o.r25)} a ${fG(o.r75)} · n=${o.ng} · cidade ${fG(sp && sp.r50)}` : `n=${o.ng}`),
        kpi('Acima do CDI', gray(fP(o.bate), o.ng < NMIN), `líquido de custos ${fG(liq(o.r50))}`),
      ].join('')}</div>
      <div class="fl-two" style="margin-top:10px"><div><h4 class="fl-h4">Flips por trimestre (8T), por faixa de holding</h4><div id="flDsSer" class="chart" style="height:190px"></div></div>
      <div><h4 class="fl-h4">Prédios mais quentes (8T, n ≥ 3; cinza abaixo do mínimo do ranking)</h4><ol class="fl-top">${tp.map(r => li(r, r.end || r.k, `data-lot="${esc(r.k)}"`)).join('') || '<li class="muted">nenhum prédio com 3+ flips</li>'}</ol>
      <h4 class="fl-h4">Ruas (8T, estoque ≥ 100)</h4><ol class="fl-top">${tr.map(r => li(r, r.nome || r.k, 'data-x="1"')).join('') || '<li class="muted">nenhuma rua com 3+ flips</li>'}</ol>
      ${R.viewOn && !R.viewOn('flips') ? '' : '<button type="button" class="linkbtn" data-radar="1">no radar de flips →</button>'}</div></div>`;
      el.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; if (b.dataset.lot) R.openLot(cd, b.dataset.lot); else if (b.dataset.radar) { S.p.flR = cd; R.setView('flips'); } };
      const a = SR.r[cd]; if (!a) return;
      const q0 = qnum(SR.q0), n = a.madura[0].length, idx = []; for (let i = n - 8; i < n; i++) idx.push(i);
      const col = bandCols(), X = idx.map(i => qlab(q0 + i)), c = R.chart('flDsSer'); if (!c) return;
      c.setOption(Object.assign(R.base(), {grid: {left: 36, right: 8, top: 8, bottom: 22},
        xAxis: R.ax({type: 'category', data: X, axisLabel: {color: css('--muted'), fontSize: 10}}), yAxis: R.ax({type: 'value', minInterval: 1, axisLabel: {color: css('--muted'), fontSize: 10}}),
        tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: ps => { const i = idx[ps[0].dataIndex]; return tip(`${X[ps[0].dataIndex]} · ${R.dname(cd)}`, [['3–12 m', nf0.format(a.madura[1][i]), col.f312], ['< 3 m (relâmpago)', nf0.format(a.madura[0][i]), col.rel], ['Revendas válidas', nf0.format(a.madura[3][i])], ['Negócios de unidade pronta', nf0.format(a.madura[4][i])]], 'estoque maduro · holding ≤ 12 m'); }}),
        series: [{type: 'bar', stack: 'f', data: idx.map(i => a.madura[1][i]), itemStyle: {color: col.f312}, barCategoryGap: '25%'}, {type: 'bar', stack: 'f', data: idx.map(i => a.madura[0][i]), itemStyle: {color: col.rel, decal: HATCH}}]}), true);
    }).catch(e => { el.innerHTML = `<p class="sub">Flips indisponíveis (${esc(e && e.message || e)}): abra a página pela URL do serve.py.</p>`; });
  }});

/* ════════ SEÇÃO · PRÉDIO: cadeias compra → venda por unidade ════ */
function flagTxt(M, fl, mot) {
  const out = M.flags.filter((_, i) => i >= 4 && fl & (1 << i));
  if (mot != null) out.push('fora do ganho: ' + M.motivos[mot]);
  return out;
}
function kindOf(fl) { return fl & 1 ? ['flip', 'fl-k1'] : fl & 2 ? ['revenda rápida', 'fl-k2'] : fl & 4 ? ['revenda', 'fl-k3'] : ['fora', 'fl-k0']; }
R.registerSection('predio', {id: 'flips', title: 'Revendas e flips neste lote', order: 25,
  sub: 'Cada linha é um par compra → venda da mesma unidade (SQL). Flip = revenda em ≤ 12 m; ganho = valor declarado nas guias (bruto: sem reforma, IR ou custos).',
  render(el, ctx) {
    const cd = ctx.cd, l = ctx.lot; if (!l) return false;
    freshChart(el);
    el.innerHTML = '<div class="loading">Carregando as cadeias de revenda…</div>';
    Promise.all([loadP('meta.json'), loadP('lotes/' + cd + '.json')]).then(([M, J]) => {
      if (S.view !== 'predio' || S.lot !== l.id) return;
      const L = J.lots[l.id];
      if (!L) { el.innerHTML = `<p class="sub">Nenhuma unidade deste lote tem dois negócios de compra e venda registrados (é preciso uma compra e uma venda da mesma unidade para formar o par).</p>${giroHtml(l, M)}`; giroChart(ctx, M); return; }
      const s = L.s, e = L.e, units = unitsOf(l);
      const rate5 = units ? s[0] / units / 5 * 1000 : null, city = (M.cubo_cidade_8T || {})[`${l.t === 'casa' ? 'casa' : l.t === 'sala' ? 'sala' : 'apto'}_todas`];
      el.innerHTML = `<div class="kpis">${[
        kpi('Flips em 5 anos', nf0.format(s[0]), `${nf0.format(s[2])} em &lt; 3 m · ${nf0.format(s[1])} revendas ≤ 24 m`),
        kpi('Por 1.000 unid./ano', rate5 != null ? fRate(rate5) : '—', `5 anos · ${units ? nf0.format(units) + ' unid. no IPTU (sem vagas)' : ''}${city ? ` · cidade ${fRate(city.rate)}` : ''}`),
        kpi('Holding mediano (flips)', fMes(s[3]), '5 anos'),
        kpi(ganhoLb('Ganho real bruto (flips)'), gray(fG(s[4]), s[5] < 5), `n=${s[5]} · mediana, 5 anos`),
        kpi('Unidades com revenda', nf0.format(s[7]), `${nf0.format(s[6])} pares · ${nf0.format(s[9])} flips desde 2006`),
        ...(e ? [kpi('Vendidas até 3 anos da entrega', fP(e[3]), `1º ano ${fP(e[2])} · nunca ${fP(e[4])} · ACC ${e[0]} · ${nf0.format(e[1])} aptos`),
          kpi('Da entrega à 1ª venda', e[5] != null ? nf1.format(e[5]) + ' anos' : '—', 'mediana das unidades vendidas (SQL próprio)')] : []),
      ].join('')}</div>
      <div class="ctrlrow" style="margin:10px 0 4px"><label class="chk"><input type="checkbox" class="fl-only"> só flips e revendas rápidas (≤ 24 m)</label><span class="muted" style="font-size:12px">passe o mouse nos ⚑ para ver as flags · ${nf0.format(s[6])} pares em ${nf0.format(L.u.length)} unidades</span></div>
      <div class="tablewrap fl-chain"></div>${giroHtml(l, M)}`;
      const box = el.querySelector('.fl-chain'), only = el.querySelector('.fl-only');
      const rowsAll = []; L.u.slice().sort((a, b) => NAT.compare(a[0], b[0])).forEach(([lb, prs]) => prs.forEach(p => rowsAll.push({lb, dc: p[0], dv: p[1], vc: p[2], vv: p[3], h: p[4], gr: p[5], gn: p[6], fl: p[7], mot: p[8], cv: p[9]})));
      const draw = () => {
        const rows = only.checked ? rowsAll.filter(r => r.fl & 2) : rowsAll;
        R.table(box, 'flchain', [
          {k: 'lb', label: 'Unidade', f: r => esc(r.lb)},
          {k: 'dc', label: 'Compra', n: 1, f: r => `${R.fDate(r.dc)} <span class="ci">${fRs(r.vc)}</span>`},
          {k: 'dv', label: 'Venda', n: 1, f: r => `${R.fDate(r.dv)} <span class="ci">${fRs(r.vv)}</span>`},
          {k: 'h', label: 'Holding', n: 1, f: r => fMes(r.h) + (r.fl & 64 ? ' <span class="ci" title="medido desde a guia da planta (registro em duas etapas colapsado)">↺</span>' : '')},
          {k: 'gr', label: 'Ganho real bruto ⓘ', title: GANHO_TT, n: 1, f: r => r.gr != null ? `<span title="${esc(`venda ${fRs(r.vv)} ÷ compra ${fRs(r.vc)}, descontado o IPCA do período (${fMes(r.h)})`)}">${dot(r.gr)}${fG(r.gr)}</span>` : '<span class="gray">—</span>'},
          {k: 'gn', label: 'Nominal', n: 1, f: r => r.gn != null ? fG(r.gn) : '<span class="gray">—</span>'},
          {k: 'cv', label: 'Compra ÷ VVR', n: 1, f: r => r.cv != null ? fX(r.cv) : '—'},
          {k: 'fl', label: 'Tipo', sv: r => (r.fl & 1 ? 3 : r.fl & 2 ? 2 : r.fl & 4 ? 1 : 0), f: r => { const [t, c] = kindOf(r.fl); return `<span class="pill ${c}">${t}</span>`; }},
          {k: 'fx', label: 'Flags', sort: false, f: r => { const ft = flagTxt(M, r.fl, r.mot); return ft.length ? `<span class="fl-flag" title="${esc(ft.join(' · '))}">⚑ ${ft.length}</span>` : ''; }},
        ], rows, {sort: null, page: 12, pageKey: l.id + only.checked, rowAttr: r => r.fl & 4 ? '' : 'style="color:var(--muted)"'});
      };
      only.onchange = draw; draw();
      giroChart(ctx, M);
    }).catch(err => { el.innerHTML = `<p class="sub">Cadeias de revenda indisponíveis (${esc(err && err.message || err)}): abra pelo serve.py.</p>`; });
  }});
const NAT = new Intl.Collator('pt-BR', {numeric: true, sensitivity: 'base'});
/* como o ganho é calculado (A2_02_pares.py): r = valor de venda ÷ valor de compra (valores declarados nas duas guias da mesma unidade,
   somando as vagas quando vêm no mesmo pacote); real = r ÷ (1 + IPCA acumulado do mês da compra ao mês da venda) − 1 */
const GANHO_TT = 'Ganho real bruto = (valor de venda ÷ valor de compra) ÷ (1 + IPCA acumulado entre o mês da compra e o da venda) − 1.\n' +
  'Valores declarados nas duas guias de ITBI da mesma unidade (SQL), somando as vagas quando vêm juntas.\n' +
  'Bruto: sem ITBI (3%), escritura e registro (~1,5%), corretagem (~6%), IR e reforma. Mediana dos pares válidos.';
const ganhoLb = t => `<span title="${esc(GANHO_TT)}">${t} ⓘ</span>`;
/* unidades do lote sem as vagas: aptos quando há; senão unidades − vagas (IPTU 2026) */
function unitsOf(l) { const u = l.u; if (!u || !u[0]) return null; return u[1] > 0 ? u[1] : Math.max(1, u[0] - (u[2] || 0)); }
function giroHtml(l, M) {
  const acc = l.u && l.u[4], ap = unitsOf(l);
  if (!acc || acc < 1995 || !ap || ap < 8) return '';
  return `<h4 class="fl-h4" style="margin-top:12px">Giro por idade do prédio <span class="muted" style="font-weight:400">vendas de SQL próprio no ano (${l.u && l.u[1] > 0 ? 'apartamentos' : esc((R.TIPO_LB[l.t] || l.t || '').toLowerCase())}) ÷ unidades sem vagas (IPTU 2026); tracejado = prédios de apartamentos da cidade (ACC 2008–19)</span></h4><div class="chart fl-giro" style="height:170px"></div>`;
}
function giroChart(ctx, M) {
  const l = ctx.lot, F = ctx.F, acc = l.u && l.u[4], ap = unitsOf(l), tc = l.u && l.u[1] > 0 ? R.TC.apto : R.TC[l.t];
  const el = document.querySelector('#sec-predio-flips .fl-giro'); if (!el || !F || !acc) return;
  const d = F.deals, cnt = {}, y1 = +(R.M.last_date || '2026').slice(0, 4);
  (ctx.ks || []).forEach(k => { if (d.t[k] !== tc) return; const y = new Date(Date.UTC(2006, 0, 1) + d.d[k] * 864e5).getUTCFullYear(); const i = y - acc; if (i >= 0 && i <= 15) cnt[i] = (cnt[i] || 0) + 1; });
  const n = Math.min(15, y1 - 1 - acc); if (n < 0) return;
  const X = []; for (let i = 0; i <= n; i++) X.push(i);
  const city = Object.fromEntries((M.giro_idade || []).map(x => [x[0], x[1]]));
  const c = echarts.init(el);
  c.setOption(Object.assign(R.base(), {grid: {left: 40, right: 10, top: 8, bottom: 36},
    xAxis: R.ax({type: 'category', data: X.map(i => i === 0 ? 'ano 0' : i), axisLabel: {color: css('--muted'), fontSize: 10}, name: 'anos desde o ACC', nameLocation: 'middle', nameGap: 22, nameTextStyle: {fontSize: 10, color: css('--muted')}}),
    yAxis: R.ax({type: 'value', axisLabel: {color: css('--muted'), fontSize: 10, formatter: v => nf0.format(v) + '%'}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: ps => { const i = X[ps[0].dataIndex]; return tip(`${acc + i} (ano ${i} do prédio)`, [[`Vendas de SQL próprio (${R.TIPO_LB[l.u && l.u[1] > 0 ? 'apto' : l.t] || l.t})`, nf0.format(cnt[i] || 0)], ['Giro do prédio', fP(100 * (cnt[i] || 0) / ap)], ['Cidade (mesma idade)', i <= 10 && city[i] != null ? fP(city[i]) : '—']], `ACC ${acc} · ${ap} unidades · ano ${y1} parcial fora`); }}),
    series: [{type: 'bar', data: X.map(i => 100 * (cnt[i] || 0) / ap), itemStyle: {color: R.RAMP[R.mode()].seq[4]}, barCategoryGap: '30%'},
      {type: 'line', data: X.map(i => i <= 10 && city[i] != null ? city[i] : null), symbol: 'none', lineStyle: {color: css('--ink-2'), type: 'dashed', width: 1.3}}]}), true);
}

/* ════════ SEÇÃO · LANÇAMENTO (vista Lançamento do módulo licenciado): quem comprou na planta e revendeu ════ */
R.registerSection('lancamento', {id: 'flips', title: 'Flips: quem comprou na planta e revendeu', order: 35,
  sub: 'Guias da planta ligadas ao SQL individualizado (ITBI). Holding desde a planta; ganho bruto declarado sobre o preço da planta (sem INCC nem parcelamento).',
  render(el, ctx, card) {   // sem lote ligado ou sem revenda: a seção some (não fica em branco)
    const ids = [...new Set((ctx && ctx.lotes || []).map(x => typeof x === 'string' ? x : x && (x.id || x.lot_id || x.lot)).filter(Boolean))];
    if (!ids.length) return false;
    el.innerHTML = '<div class="loading">Carregando revendas dos lotes ligados…</div>';
    Promise.all([loadP('planta.json'), loadP('meta.json')]).then(([PJ, M]) => {
      const f = PJ.f, rows = ids.map(id => { const a = PJ.lots[id]; if (!a) return null; const o = {id}; f.forEach((k, i) => { o[k] = a[i]; }); return o; }).filter(Boolean);
      const c = PJ.cidade, p8 = M.p_a2_8 || {};
      const warn = `<p class="fl-warn">Aviso P-A2-8: parte da “revenda” curta num prédio novo é a mesma compra registrada duas vezes (guia da planta e, na entrega, a do SQL da unidade). Colapsamos o par planta → 1ª guia em ≤ 12 m com valor 0,85–1,15× (${nf0.format(p8.pares_2e || 0)} na cidade). A ponte planta → unidade cobre só 26–30% das safras 2021–23: o resto não entra aqui.</p>`;
      if (!rows.length || !rows.some(r => r.n_pl || r.n_rev3 || r.n_2e)) { if (card) card.hidden = true; return; }
      const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
      const one = rows.length === 1 ? rows[0] : rows.slice().sort((a, b) => b.n_pl + b.n_rev3 - a.n_pl - a.n_rev3)[0];
      const r3 = sum('n_rev3'), r312 = sum('n_rev3_12');
      el.innerHTML = `<div class="kpis">${[
        kpi('Comprou na planta → revendeu', nf0.format(sum('n_pl')), `${nf0.format(sum('n_pl12'))} em ≤ 12 m desde a planta · cidade: ${nf0.format(c.n_pl)}`),
        kpi('Holding desde a planta', gray(fMes(one.h50), one.n_pl < 5), one.h50 != null ? `IQR ${nf1.format(one.h25)}–${nf1.format(one.h75)} m · cidade ${fMes(c.h50)}` : 'sem revenda de quem comprou na planta'),
        kpi(ganhoLb('Ganho real bruto'), gray(fG(one.r50), one.ng < 5), one.r50 != null ? `IQR ${fG(one.r25)} a ${fG(one.r75)} · n=${one.ng} · cidade ${fG(c.r50)}` : `n=${one.ng}`),
        kpi('Revendas ≤ 12 m nos 3 primeiros anos', r3 ? fP(100 * r312 / r3) : '—', `${nf0.format(r312)} de ${nf0.format(r3)} revendas do prédio até 3 anos de idade`),
        kpi('Registro em duas etapas', nf0.format(sum('n_2e')), 'pares planta → escritura colapsados (não são revenda)'),
      ].join('')}</div>` +
        (rows.length > 1 ? `<p class="note">Holding e ganho: lote ${esc(one.id)} (o de mais revendas entre os ${rows.length} ligados); contagens somam todos.</p>` : '') +
        `<p class="note">${rows.map(r => `<button type="button" class="linkbtn" data-cd="${esc(r.cd)}" data-lot="${esc(r.id)}">lote ${esc(r.id.slice(0, 3) + '.' + r.id.slice(3, 6) + '.' + r.id.slice(6, 10) + (r.id.slice(10) !== '00' ? '-' + r.id.slice(10) : ''))} →</button>`).join(' · ')} (cadeias por unidade na página do prédio)</p>${warn}`;
      el.onclick = ev => { const b = ev.target.closest('button[data-lot]'); if (b) R.openLot(b.dataset.cd, b.dataset.lot); };
    }).catch(() => { if (card) card.hidden = true; });
  }});

/* pré-carrega o que a vista pronta e a cor dos distritos usam (render quando chegar) */
if (myView()) { get('meta.json'); cube(); }
