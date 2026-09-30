/* ════════ Módulo Terrenos · unificação de lotes → incorporação (A3) ════════
   Dados: terrenos/*.json (build_terrenos.py). A fonte licenciada (uso interno) só existe quando o módulo dono dela está montado
   e publica R.licenciado = {nome, selo, por_ref, por_ref_elo}; os arquivos ficam à parte (terrenos/<por_ref>.json) e nunca são
   lidos sem essa flag. Sem ela, os painéis/KPIs/linhas que dependem da fonte somem (sem aviso), S3 fica vazio e S4 conta só a
   1ª guia de planta (ITBI). Estágios: S1 sinal (A+ por quadra) · S2 unificado (IPTU ± 12 m) · S3 oferta futura (fonte licenciada)
   · S4 lançado (fonte licenciada ou 1ª guia de planta) · S5 individualizado. Traço e forma por estágio; laranja só no S4. */
const {esc, nf0, nf1, nf2, css, clamp, med, qt} = R;
const DIR = 'terrenos/';
const MB = 26 * 12 + 7 + 6 / 31;      // data-base ITBI 07/08/2026, em meses desde jan/2000
const YB = 2026;                       // última vintage do IPTU
/* fonte licenciada (uso interno): só quando o módulo dono está montado (R.licenciado). Sem ela, tudo que a cita some da tela. */
const LIC_ON = !!R.licenciado, FONTE = LIC_ON ? R.licenciado.nome : '';
const LIC = LIC_ON ? '<span class="lic">' + esc(R.licenciado.selo) + '</span>' : '';
const STAGES = LIC_ON ? [1, 2, 3, 4, 5] : [1, 2, 4, 5];   // S3 só existe com a fonte licenciada
const ST_LB = {1: 'S1 sinal', 2: 'S2 unificado', 3: 'S3 oferta futura', 4: 'S4 lançado', 5: 'S5 individualizado'};
const ST_SUB = {1: 'lotes vizinhos comprados (ITBI) · A+ por quadra', 2: 'lote unificado no IPTU (± 12 m)', 3: `oferta futura na ${FONTE}`,
  4: LIC_ON ? `${FONTE} ou 1ª guia de planta (ITBI)` : '1ª guia de planta (ITBI)', 5: 'condomínio com unidades no IPTU'};
const TP_LB = {U: 'Condomínio sobre lotes unificados', L: 'Condomínio em lote único', N: 'Lote unificado (ainda sem condomínio)'};
const K_LB = {4: 'Casas antigas em eixo de metrô', 2: 'Terreno vago ou estacionamento grande', 1: 'Galpão ou indústria', 0: 'Casas de miolo de bairro', 3: 'Prédio existente individualizado'};
const Z_LB = {E: 'Eixo (ZEU/ZEM)', P: 'Eixo previsto (ZEUP/ZEMP)', C: 'Centralidade / corredor', M: 'Mista (ZM)', O: 'Outras (ZER, ZEIS, ZPI…)', '': 'sem zona'};
const ZK = ['E', 'P', 'C', 'M', 'O', ''];
const ZF = {todas: null, eixos: ['E', 'P'], centr: ['C'], mista: ['M'], outras: ['O', '']};
const ZF_LB = {todas: 'todas', eixos: 'eixos ZEU/ZEUP', centr: 'centralidades', mista: 'mista (ZM)', outras: 'outras'};
const PERMUTA = 'Permutas não aparecem como compra e venda: o custo do terreno pode estar subestimado.';
const F6 = 'sem registro no ITBI (limite da fonte: o arquivo antigo omite guias de SQL cancelado antes de 2023)';
const ZONA_NOTA = 'Zoneamento da Lei 18.177/2024 aplicado a lotes de antes de 2024: anacrônico (o eixo pode ter sido revisto onde já havia incorporação).';

/* ── formatação ── */
const fMoney = v => v == null ? '—' : v >= 1e9 ? 'R$ ' + nf1.format(v / 1e9) + ' bi' : v >= 1e6 ? 'R$ ' + nf1.format(v / 1e6) + ' mi' : v >= 1e3 ? 'R$ ' + nf0.format(v / 1e3) + ' mil' : 'R$ ' + nf0.format(v);
const fM2 = v => v == null ? '—' : nf0.format(v) + ' m²';
const fRs = v => v == null ? '—' : 'R$ ' + nf0.format(v) + '/m²';
const fX = v => v == null ? '—' : nf2.format(v) + '×';
const fMes = v => v == null ? '—' : nf0.format(v) + ' m';
const fI = v => v == null ? '—' : nf0.format(Math.round(v) || 0);     // sem “-0”
const mYM = v => v == null ? null : (Math.floor(v / 100) - 2000) * 12 + (v % 100) - 1;          // AAAAMM
const mYMD = v => v == null ? null : mYM(Math.floor(v / 100)) + ((v % 100) - 1) / 31;           // AAAAMMDD
const mYYMM = v => v == null ? null : Math.floor(v / 100) * 12 + (v % 100) - 1;                 // AAMM
const mYYMMDD = v => v == null ? null : mYYMM(Math.floor(v / 100)) + ((v % 100) - 1) / 31;      // AAMMDD
const fMo = m => m == null ? '—' : String(Math.floor(((m % 12) + 12) % 12) + 1).padStart(2, '0') + '/' + (2000 + Math.floor(m / 12));
const fDay = v => v == null ? '—' : String(v % 100).padStart(2, '0') + '/' + String(Math.floor(v / 100) % 100).padStart(2, '0') + '/' + Math.floor(v / 10000);
const sqLb = sq => sq ? sq.slice(0, 3) + '.' + sq.slice(3, 6) : '—';
const sqlLb = s => s ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 10)}-${s.slice(10)}` : '—';
const iqrTxt = a => a && a[3] ? `${nf0.format(a[1])} [${nf0.format(a[0])}–${nf0.format(a[2])}] · n=${nf0.format(a[3])}` : '—';
const q3 = arr => { const v = arr.filter(x => x != null); return v.length ? [qt(v, .25), med(v), qt(v, .75), v.length] : null; };

/* glifos de estágio (legenda, funil, painel): traço e forma, nunca matiz novo; laranja só no S4 */
function glyph(s, w = 24) {
  if (s === 4) return `<svg class="tg" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="var(--pl)" stroke="var(--surface)" stroke-width="1"/></svg>`;
  const d = {1: 'stroke-dasharray="0.1 3.4" stroke-linecap="round" stroke-width="2.2"', 2: 'stroke-dasharray="5 3" stroke-width="1.6"',
    3: 'stroke-dasharray="5 3" stroke-width="3.2"', 5: 'stroke-width="1.6"'}[s] || '';
  return `<svg class="tg" width="${w}" height="10" viewBox="0 0 ${w} 10" aria-hidden="true"><line x1="1.5" y1="5" x2="${w - 1.5}" y2="5" stroke="${s === 5 ? 'var(--muted)' : 'var(--ink)'}" ${d}/></svg>`;
}

/* ── dados ─────────────────────────────────────────────── */
const TD = {ev: null, byId: {}, rad: null, meta: null, flu: null, pad: null, por: null, porErr: null, porP: null, semLic: !LIC_ON, elo: null, geo: {}, lid: {}, ver: 0, err: null};
function decodeEv(j) {
  const out = []; let x = 0, y = 0; const yr = v => v == null ? null : 2000 + v;
  for (let i = 0; i < j.n; i++) {
    x += j.x[i]; y += j.y[i];
    out.push({i, id: j.id[i], cd: j.cd[i], c: [x / 1e5, y / 1e5], st0: j.st[i], st: j.st[i], tp: j.tp[i], k: j.k[i], z: j.z[i] || '',
      de: j.de[i] == null ? null : j.de[i] * 10, nl: j.nl[i], a: j.a[i], un: j.un[i], te: yr(j.te[i]), tu: yr(j.tu[i]), s2: yr(j.s2[i]),
      du: mYYMM(j.du[i]), pl: mYYMMDD(j.pl[i]), ob: j.ob[i], nc: j.nc[i], vn: j.vn[i], vr: j.vr[i], rs: j.rs[i],
      pm: j.pm[i] == null ? null : j.pm[i] / 100, c2: mYYMM(j.c2[i]), refs: [], lanc: null, st3: false});
  }
  return out;
}
function decodeRad(j) {
  const q = j.q, out = [];
  for (let i = 0; i < q.id.length; i++) out.push({i, id: q.id[i], cd: q.cd[i], c: [q.x[i] / 1e5, q.y[i] / 1e5], nA: q.nA[i], n: q.n[i], a: q.a[i],
    vn: q.vn[i], vr: q.vr[i], rs: q.rs[i], pm: q.pm[i] == null ? null : q.pm[i] / 100, pmx: q.pmx[i] == null ? null : q.pmx[i] / 100,
    z: q.z[i] || '', zn: q.zn[i], ca: q.ca[i], de: q.de[i], rec: q.rec[i], u1: mYM(q.u1[i]), u2: mYM(q.u2[i]), face: q.face[i], rua: q.rua[i], s2: q.s2[i], uso: q.uso[i]});
  const b = j.bc;
  return {q: out, byId: Object.fromEntries(out.map(r => [r.id, r])), bc: b.x.map((x, i) => ({c: [x / 1e5, b.y[i] / 1e5], n: b.n[i], nB: b.nB[i], tot: b.tot[i]}))};
}
let corePr = null;
function loadCore() {
  if (corePr) return corePr;
  corePr = Promise.all(['eventos', 'radar', 'meta', 'fluxo', 'padroes'].map(f => R.loadJSON(DIR + f + '.json'))).then(([e, r, m, f, p]) => {
    TD.ev = decodeEv(e); TD.ev.forEach(x => { TD.byId[x.id] = x; });
    TD.rad = decodeRad(r); TD.meta = m; TD.flu = f; TD.pad = p; TD.ver++;
    return TD;
  }).catch(err => { corePr = null; TD.err = err; throw err; });
  return corePr;
}
/* fonte licenciada (uso interno): Referência → evento; aplica S3/S4 sem rebaixar o S5 do IPTU.
   Sem o módulo dono (R.licenciado ausente) não há fetch: resolve "indisponível" em silêncio (TD.por = null, TD.semLic = true). */
function loadPor() {
  if (TD.porP) return TD.porP;
  if (!LIC_ON) { TD.por = null; TD.porErr = false; TD.semLic = true; return (TD.porP = Promise.resolve(null)); }
  TD.porP = loadCore().then(() => R.loadJSON(DIR + R.licenciado.por_ref)).then(p => {
    TD.por = p; TD.porErr = null;
    for (const [ref, r] of Object.entries(p.refs)) {
      const e = TD.byId[r.ev]; if (!e) continue;
      e.refs.push(ref);
      if (r.st === 'oferta_futura') { if (e.st0 < 3) { e.st = Math.max(e.st, 3); e.st3 = true; } continue; }
      const lm = mYM(r.lanc);
      if (lm != null && (e.lanc == null || lm < e.lanc)) e.lanc = lm;
      if (e.st0 < 4) e.st = 4;
    }
    TD.ver++; return p;
  }).catch(err => { TD.porErr = err; TD.porP = null; return null; });
  return TD.porP;
}
function loadGeo(cd) {
  if (!cd) return Promise.reject(new Error('sem distrito'));
  return R.loadJSON(DIR + 'geo/' + cd + '.json').then(g => {
    if (!TD.geo[cd]) { TD.geo[cd] = g; for (const [id, d] of Object.entries(g.ev)) TD.lid[d.lid] = id; }
    return g;
  });
}
const evDet = e => e && TD.geo[e.cd] ? TD.geo[e.cd].ev[e.id] : null;

/* ── filtros (URL): janela, zona, mínimo de lotes, estágio ── */
const P = (R.S.p.tr = R.S.p.tr || {tj: 24, tz: 'todas', tl: 2, te: 0, bc: false});
R.registerParam({k: 'tj', get: () => String(P.tj), set: v => { P.tj = [12, 24, 36].includes(+v) ? +v : 24; }, def: '24', views: ['terrenos']});
R.registerParam({k: 'tz', get: () => P.tz, set: v => { P.tz = ZF[v] !== undefined ? v : 'todas'; }, def: 'todas', views: ['terrenos']});
R.registerParam({k: 'tl', get: () => String(P.tl), set: v => { P.tl = [1, 2, 3, 4].includes(+v) ? +v : 2; }, def: '2', views: ['terrenos']});
R.registerParam({k: 'te', get: () => String(P.te || ''), set: v => { P.te = STAGES.includes(+v) ? +v : 0; }, def: '', views: ['terrenos']});

const passEv = e => e.k != null && e.k !== 3 && e.nl >= P.tl && (!ZF[P.tz] || ZF[P.tz].includes(e.z));
const passQ = q => q.n >= P.tl && (!ZF[P.tz] || ZF[P.tz].includes(q.z));
function winStages(e) {                    // estágios em que o evento entrou dentro da janela
  const y0 = YB - P.tj / 12 + 1, m0 = MB - P.tj, s = [];
  if (e.s2 != null && e.s2 >= y0) s.push(2);
  if (e.st3) s.push(3);                    // foto da fonte licenciada (sem data de entrada)
  const l = e.lanc != null ? e.lanc : e.pl;
  if (e.st >= 4 && l != null && l >= m0) s.push(4);
  if (e.st0 === 5 && e.tu != null && e.tu >= y0) s.push(5);
  return s;
}
const qInWin = q => P.tj >= 24 || q.u2 >= MB - P.tj;

/* ── camadas no mapa (Cidade e radar): centróides 11–13, polígonos ≥ 13, traço por estágio ── */
const IC = {1: 'app-terrenos-i1', 2: 'app-terrenos-i2', 3: 'app-terrenos-i3', 4: 'app-terrenos-i4', 5: 'app-terrenos-i5'};
function ringImg(s) {
  const n = 44, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  const ink = css('--ink'), sur = css('--surface'), mut = css('--muted');
  const circ = (lw, col, dash) => { g.beginPath(); g.arc(n / 2, n / 2, 13, 0, 2 * Math.PI); g.setLineDash(dash || []); g.lineWidth = lw; g.strokeStyle = col; g.lineCap = s === 1 ? 'round' : 'butt'; g.stroke(); };
  g.beginPath(); g.arc(n / 2, n / 2, 13, 0, 2 * Math.PI); g.fillStyle = sur; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
  circ(s === 3 ? 9 : 7, sur);                                        // halo da cor da superfície: lê sobre qualquer fundo
  if (s === 1) circ(4, ink, [0.1, 6.5]);
  else if (s === 2) circ(3, ink, [7, 4]);
  else if (s === 3) circ(6, ink, [7, 4]);
  else circ(3, mut);
  return g.getImageData(0, 0, n, n);
}
function putIcons(map) {
  [1, 2, 3, 5].forEach(s => R.putImage(map, IC[s], ringImg(s)));
  R.putImage(map, IC[4], R.diamondImg(css('--pl'), css('--surface'), 4));
}
const LIDS = {bc: 'app-terrenos-bc', fill: 'app-terrenos-fill', orig: 'app-terrenos-orig', l1: 'app-terrenos-l1', l2: 'app-terrenos-l2', l3: 'app-terrenos-l3',
  l4: 'app-terrenos-l4', l5: 'app-terrenos-l5', pts: 'app-terrenos-pts', p4: 'app-terrenos-p4', sel: 'app-terrenos-sel'};
function addTrLayers(map, before) {
  const fresh = !map.getSource('app-terrenos-pts');
  putIcons(map);
  R.upsertSrc(map, 'app-terrenos-bc', R.EMPTY_FC, true);
  R.upsertSrc(map, 'app-terrenos-pol', R.EMPTY_FC, true);
  R.upsertSrc(map, 'app-terrenos-pts', R.EMPTY_FC, true);
  R.upsertSrc(map, 'app-terrenos-sel', R.EMPTY_FC, true);
  R.addLayerOnce(map, {id: LIDS.bc, type: 'circle', source: 'app-terrenos-bc', minzoom: 10,
    paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['*', 0.55, ['sqrt', ['get', 'n']]], 14, ['*', 2.2, ['sqrt', ['get', 'n']]]], 'circle-opacity': 0.09, 'circle-stroke-width': 0.6, 'circle-stroke-opacity': 0.25}}, before);
  R.addLayerOnce(map, {id: LIDS.fill, type: 'fill', source: 'app-terrenos-pol', minzoom: 13, filter: ['!=', ['get', 'o'], 1], paint: {'fill-opacity': ['case', ['==', ['get', 'st'], 4], 0.16, 0.05]}}, before);
  R.addLayerOnce(map, {id: LIDS.orig, type: 'line', source: 'app-terrenos-pol', minzoom: 13, filter: ['==', ['get', 'o'], 1], paint: {'line-width': 1, 'line-dasharray': [2, 2]}});
  const line = (id, s, w, dash, cap) => R.addLayerOnce(map, {id, type: 'line', source: 'app-terrenos-pol', minzoom: 13, filter: ['all', ['!=', ['get', 'o'], 1], ['==', ['get', 'st'], s]],
    layout: {'line-cap': cap || 'butt', 'line-join': 'round'}, paint: Object.assign({'line-width': w}, dash ? {'line-dasharray': dash} : {})});
  line(LIDS.l5, 5, 1.4); line(LIDS.l2, 2, 1.8, [3, 2]); line(LIDS.l3, 3, 3.2, [3, 1.6]); line(LIDS.l1, 1, 2.2, [0.1, 1.9], 'round'); line(LIDS.l4, 4, 2.4);
  const isz = ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'st'], 1], 0.62, 0.48], 13, 0.72, 16, 0.9];
  R.addLayerOnce(map, {id: LIDS.pts, type: 'symbol', source: 'app-terrenos-pts', minzoom: 11, maxzoom: 13, filter: ['!=', ['get', 'st'], 4],
    layout: {'icon-image': ['get', 'ic'], 'icon-size': isz, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['-', 10, ['get', 'st']]}});
  R.addLayerOnce(map, {id: LIDS.p4, type: 'symbol', source: 'app-terrenos-pts', minzoom: 11, filter: ['==', ['get', 'st'], 4],
    layout: {'icon-image': IC[4], 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.42, 13, 0.55, 16, 0.7], 'icon-allow-overlap': true, 'icon-ignore-placement': true}});
  R.addLayerOnce(map, {id: LIDS.sel, type: 'line', source: 'app-terrenos-sel', paint: {'line-width': 3.2, 'line-opacity': 0.9}});
  const ink = css('--ink'), mut = css('--muted');
  [LIDS.l1, LIDS.l2, LIDS.l3].forEach(id => map.setPaintProperty(id, 'line-color', ink));
  map.setPaintProperty(LIDS.l4, 'line-color', css('--pl'));
  map.setPaintProperty(LIDS.l5, 'line-color', mut);
  map.setPaintProperty(LIDS.orig, 'line-color', mut);
  map.setPaintProperty(LIDS.fill, 'fill-color', ['case', ['==', ['get', 'st'], 4], css('--pl'), ink]);
  map.setPaintProperty(LIDS.bc, 'circle-color', ink); map.setPaintProperty(LIDS.bc, 'circle-stroke-color', ink);
  map.setPaintProperty(LIDS.sel, 'line-color', ink);
  return fresh;
}
const HIT = [LIDS.p4, LIDS.pts, LIDS.l1, LIDS.l2, LIDS.l3, LIDS.l4, LIDS.l5, LIDS.fill];
function evFeatures(evs, qs) {
  const f = [];
  evs.forEach(e => f.push({type: 'Feature', geometry: {type: 'Point', coordinates: e.c}, properties: {i: e.i, st: e.st, ic: IC[e.st]}}));
  qs.forEach(q => f.push({type: 'Feature', geometry: {type: 'Point', coordinates: q.c}, properties: {q: q.i, st: 1, ic: IC[1]}}));
  return {type: 'FeatureCollection', features: f};
}
function polyFeatures(cds, evOk, qOk) {
  const f = [];
  cds.forEach(cd => {
    const G = TD.geo[cd]; if (!G) return;
    for (const [id, d] of Object.entries(G.ev)) {
      const e = TD.byId[id]; if (!e || !evOk(e) || !d.g.length) continue;
      f.push({type: 'Feature', geometry: ringsGeom(d.g), properties: {i: e.i, st: e.st}});
      (d.o || []).forEach(o => { if (o.length) f.push({type: 'Feature', geometry: ringsGeom(o), properties: {i: e.i, st: e.st, o: 1}}); });
    }
    for (const [qid, d] of Object.entries(G.sq || {})) {
      const q = TD.rad.byId[qid]; if (!q || !qOk(q)) continue;
      d.l.forEach(l => { if (l[6] && l[6].length) f.push({type: 'Feature', geometry: ringsGeom(l[6]), properties: {q: q.i, st: 1}}); });
    }
  });
  return {type: 'FeatureCollection', features: f};
}
function ringsGeom(g) { const rs = R.decodeRings(g); return rs.length === 1 ? {type: 'Polygon', coordinates: [rs[0]]} : {type: 'MultiPolygon', coordinates: rs.map(r => [r])}; }
function bcFeatures(qFilter) {
  return {type: 'FeatureCollection', features: (TD.rad ? TD.rad.bc : []).filter(qFilter || (() => true)).map(b => ({type: 'Feature', geometry: {type: 'Point', coordinates: b.c}, properties: {n: b.n, nB: b.nB, tot: b.tot}}))};
}
function cdsInView(map, max = 8) {
  const b = map.getBounds(), bb = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  return R.DCODES.filter(cd => { const q = R.DIST[cd].bb; return !(q[2] < bb[0] || q[0] > bb[2] || q[3] < bb[1] || q[1] > bb[3]); }).slice(0, max);
}
function evTip(e) {
  const d = evDet(e), rows = [['Estágio', stageTxt(e)]];
  rows.push(['Lotes de origem', `${nf0.format(e.nl)} · ${fM2(e.a)} de terreno`]);
  if (e.un) rows.push(['Unidades (IPTU)', nf0.format(e.un)]);
  rows.push(['Pago pelo terreno', priceTxt(e)]);
  if (e.pm != null) rows.push(['Prêmio sobre o mercado', `${fX(e.pm)} (valor/VVR ÷ mediana do distrito no ano)`]);
  rows.push([(e.te || 0) < 2024 ? 'Zona (lei de 2024, anacrônica) · estação' : 'Zona · estação', `${Z_LB[e.z]} · ${e.de != null ? (e.de >= 3000 ? '≥ 3 km' : nf0.format(e.de) + ' m') : '—'}`]);
  if (e.k != null) rows.push(['Tipo de montagem', K_LB[e.k]]);
  if (LIC_ON && e.refs.length) rows.push([`${FONTE} (uso interno)`, e.refs.map(r => (TD.por.refs[r].nome || 'Ref. ' + r)).slice(0, 2).join(' · ')]);
  return R.tip(`${TP_LB[e.tp]}${d && d.end ? ' · ' + d.end : ''}`, rows, `${R.dname(e.cd)} · quadra ${sqLb(e.id.slice(1, 7))} · ${PERMUTA} Clique para abrir.`);
}
function qTip(q) {
  return R.tip(`Sinal A+ · quadra ${sqLb(q.id.slice(1))}${q.rua ? ' · ' + q.rua.replace(/\s+/g, ' ') : ''}`, [
    ['Lotes comprados (24 m)', `${nf0.format(q.n)} (${nf0.format(q.nA)} com sinal A+)`], ['Área comprada', fM2(q.a)],
    ['Pago', `${fMoney(q.vn)} · ${fMoney(q.vr)} em R$ de jul/26 · ${fRs(q.rs)}`], ['Prêmio (mediana · máx.)', `${fX(q.pm)} · ${fX(q.pmx)}`],
    ['Face de quadra comprada', q.face != null ? nf0.format(q.face * 100) + '% dos lotes da rua' : '—'], ['Zona · estação', `${q.zn || 'sem zona'} · ${q.de != null ? nf0.format(q.de) + ' m' : '—'}`],
    ['Última compra', fMo(q.u2)]],
  `sinal não é incorporação confirmada: no backtest acerta ${btTxt()} · ${PERMUTA}`);
}
function btTxt() { const b = TD.meta && TD.meta.bt['2021:S6_viz_premio_eixo']; return b ? `${nf1.format(b.precisao)}% (${nf1.format(b.lift)}× a taxa-base); encontra ${nf1.format(b.recall)}%` : '16,9%'; }
function featTip(f) { const p = f.properties; if (p.q != null && TD.rad) return qTip(TD.rad.q[p.q]); const e = TD.ev && TD.ev[p.i]; return e ? evTip(e) : null; }
function featClick(f) {
  const p = f.properties;
  if (p.q != null) { R.setView('terrenos', {tsel: TD.rad.q[p.q].id}); return; }
  const e = TD.ev[p.i]; if (!e) return;
  if (e.st === 4 && e.refs.length && R.viewDef('lancamento')) { R.setView('lancamento', {ref: e.refs[0]}); return; }
  R.setView('terrenos', {tsel: e.id});
}
function stageTxt(e) {
  const p = [ST_LB[e.st]];
  if (e.st === 5) p.push(`IPTU ${e.tu}${e.du != null ? ' · unidades desde ' + fMo(e.du) : ''}`);
  else if (e.st === 4) p.push(e.lanc != null ? `${FONTE} ${fMo(e.lanc)}` : e.pl != null ? `1ª guia de planta ${fMo(e.pl)}` : FONTE);
  else if (e.st === 3) p.push(`${FONTE}, foto atual`);
  else if (e.s2) p.push(`IPTU ${e.s2} (± 12 m)`);
  return p.join(' · ');
}
function priceTxt(e) {
  if (!e.ob) return F6;
  if (e.rs == null) return e.nc ? `compra identificada em ${e.nc} de ${e.nl} lotes (< 50%): sem R$/m²` : 'nenhuma compra identificada (permuta, herança, doação ou compra > 8 anos antes)';
  return `${fMoney(e.vn)} nominal · ${fMoney(e.vr)} em R$ de jul/26 · ${fRs(e.rs)}${e.nc < e.nl ? ` (${e.nc} de ${e.nl} lotes)` : ''}`;
}

/* camada da Cidade */
const LC = {ver: -1, cds: '', timer: 0};
function cityRefresh(H) {
  if (!H || !H.ready || !TD.ev) return;
  const map = H.map, stOn = s => R.camHas('terrenos:s' + s);
  if (LC.ver !== TD.ver) {
    LC.ver = TD.ver; LC.cds = '';
    const src = map.getSource('app-terrenos-pts'); if (src) src.setData(evFeatures(TD.ev.filter(e => e.k != null && e.k !== 3), TD.rad.q));
    const b = map.getSource('app-terrenos-bc'); if (b) b.setData(bcFeatures());
  }
  const sts = [1, 2, 3, 4, 5].filter(stOn);
  const ft = ['in', ['get', 'st'], ['literal', sts]];
  [LIDS.pts, LIDS.p4].forEach(id => map.getLayer(id) && map.setFilter(id, ['all', id === LIDS.p4 ? ['==', ['get', 'st'], 4] : ['!=', ['get', 'st'], 4], ft]));
  if (map.getLayer(LIDS.fill)) map.setFilter(LIDS.fill, ['all', ['!=', ['get', 'o'], 1], ft]);
  [1, 2, 3, 4, 5].forEach(s => R.visL(map, LIDS['l' + s], R.camHas('terrenos') && stOn(s)));
  R.visL(map, LIDS.bc, R.camHas('terrenos') && R.camHas('terrenos:bc'));
  cityPolys(H);
}
function cityPolys(H) {
  clearTimeout(LC.timer);
  LC.timer = setTimeout(() => {
    const map = H.map; if (!H.ready || !TD.ev || !R.camHas('terrenos') || map.getZoom() < 13) return;
    const cds = cdsInView(map);
    Promise.allSettled(cds.map(loadGeo)).then(() => {
      const key = cds.join(',') + '|' + TD.ver; if (key === LC.cds) return; LC.cds = key;
      const s = map.getSource('app-terrenos-pol'); if (s) s.setData(polyFeatures(cds, e => e.k != null && e.k !== 3, () => true));
    });
  }, 200);
}
R.registerLayer({
  id: 'terrenos', group: 'Terrenos', order: 1, label: 'Incorporações por estágio', minzoom: 11,
  title: 'Unificação de lotes → incorporação (IPTU 2011–2026) e sinais de compra de lotes vizinhos (ITBI). Traço = estágio; laranja só no lançado (S4).',
  subs: [{id: 's1', html: `${glyph(1)} S1 sinal (A+, quadra)`}, {id: 's2', html: `${glyph(2)} S2 unificado`}].concat(LIC_ON ? [{id: 's3', html: `${glyph(3)} S3 oferta futura`}] : [],
    [{id: 's4', html: `${glyph(4)} S4 lançado`}, {id: 's5', html: `${glyph(5)} S5 individualizado (histórico)`, def: false}, {id: 'bc', html: '<span class="tdot"></span> densidade B/C (sinal fraco)', def: false}]),
  add(H, below) { if (addTrLayers(H.map, below)) { LC.ver = -1; LC.cds = ''; } },
  update(H) {
    if (!R.camHas('terrenos')) return;
    if (!STAGES.some(s => R.camHas('terrenos:s' + s))) { STAGES.filter(s => s <= 4).forEach(s => R.S.cam.add('terrenos:s' + s)); R.syncUrl(); }
    if (!TD.ev) { loadCore().then(() => { loadPor().then(() => cityRefresh(R.city)); cityRefresh(R.city); if (R.S.view === 'cidade') R.render(); }).catch(() => {}); return; }
    cityRefresh(H);
  },
  setVisible(H, on) { [LIDS.pts, LIDS.p4, LIDS.fill, LIDS.orig, LIDS.sel].forEach(id => R.visL(H.map, id, on)); if (!on) [1, 2, 3, 4, 5].forEach(s => R.visL(H.map, LIDS['l' + s], false)); if (!on) R.visL(H.map, LIDS.bc, false); },
  onMove(H) { cityPolys(H); },
  hitLayers: () => HIT,
  tip: featTip, click: featClick,
  legend: () => [[1, 'S1 sinal'], [2, 'S2 unificado (IPTU ± 12 m)'], [3, `S3 oferta futura (${FONTE})`], [4, LIC_ON ? `S4 lançado (${FONTE}/planta)` : 'S4 lançado (1ª guia de planta)'], [5, 'S5 individualizado']]
      .filter(([s]) => STAGES.includes(s) && R.camHas('terrenos:s' + s)).map(([s, l]) => `<span class="it">${glyph(s)}${esc(l)}</span>`).join('') +
    (R.camHas('terrenos:bc') ? '<span class="it"><span class="tdot"></span>densidade B/C (sinal fraco ≤ 7%; círculo ∝ nº de lotes)</span>' : '') +
    `<span class="it muted">terrenos: centróides no zoom 11–13, lotes ≥ 13 · IPTU 2011–2026, ITBI até 07/08/2026 · S1 = sinal A+ (acerta ~17%), não incorporação${TD.porErr ? ` · ${esc(FONTE)} indisponível` : ''}</span>`,
  note: () => TD.err ? 'terrenos/*.json indisponível (rode build_terrenos.py e abra pelo serve.py)' : 'sinal A+ acerta ~17% em 2–4 anos · preço só p/ lotes extintos ≥ 2023',
});
R.registerPreset({id: 'terrenos', label: 'Terrenos', order: 40, met: 'none',
  cam: ['terrenos'].concat(STAGES.filter(s => s <= 4).map(s => 'terrenos:s' + s), ['trilhos', 'zoneamento']),
  title: 'Distritos neutros; terrenos por estágio S1–S4 (S5 histórico: ligue no painel), eixos do zoneamento e trilhos'});

/* ── vista Radar de Terrenos ───────────────────────────── */
const HTML = `
<div class="vhead"><div><span class="eyebrow">Radar · Terrenos</span><h2>Onde se reúne terreno para incorporar, quanto se paga e o que está em curso</h2></div>
  <p>Lotes que somem do cadastro e viram um lote unificado ou um condomínio novo (IPTU 2011–2026), as compras desses lotes no ITBI e os <b>sinais</b> de montagem em curso (lotes vizinhos comprados com prêmio, em eixo ou perto do metrô). Clique num estágio, num ponto do mapa ou numa linha para abrir.</p></div>
<div class="ctrlrow" id="trCtrl" role="group" aria-label="Filtros do radar de terrenos"></div>
<div class="card trsel" id="trSel" hidden></div>
<div class="mapgrid">
  <div class="card" style="padding:8px 10px 10px"><div id="trMap" class="chart map" role="img" aria-label="Mapa de terrenos por estágio"></div><div class="legend" id="trMapLeg"></div></div>
  <aside class="side">
    <div class="card" style="padding:10px 12px"><h3>Estágios na janela</h3><p class="sub" id="trFunSub"></p><div id="trFunnel" class="trfun"></div></div>
    <div class="kpis" id="trKpis"></div>
  </aside>
</div>
<div class="card"><h3>Sinais em curso · A+ por quadra</h3><p class="sub" id="trSigSub"></p><div class="tablewrap tall" id="trSig" style="max-height:520px"></div></div>
<div${LIC_ON ? ' class="two"' : ''}>
  <div class="card"><h3>Preço pago pelo terreno</h3><p class="sub" id="trPriceSub"></p><div class="trscroll"><div id="trPrice" class="chart" style="height:420px"></div></div><div class="legend" id="trPriceLeg"></div></div>
  ${LIC_ON ? `<div class="card"><h3>Terreno × lançamento ${LIC}</h3><p class="sub" id="trVgvSub"></p><div id="trVgv" class="chart" style="height:420px"></div><div class="legend" id="trVgvLeg"></div></div>` : ''}
</div>
<div class="two">
  <div class="card"><h3>Fluxo: terreno reunido por ano e conversão em lançamento</h3><p class="sub" id="trFlowSub"></p><div id="trFlow" class="chart" style="height:320px"></div><div class="legend" id="trFlowLeg"></div></div>
  <div class="card"><h3>Compras em quadras com sinal, por trimestre</h3><p class="sub" id="trFlowQSub"></p><div id="trFlowQ" class="chart" style="height:320px"></div><div class="legend" id="trFlowQLeg"></div></div>
</div>
<div class="card"><h3>Padrões de compra: 5 tipos de montagem</h3><p class="sub" id="trPadSub"></p><div id="trPad" class="trpad"></div>
  <div class="two" style="margin-top:12px"><div><h4 class="trh4">Taxa de incorporação 2016–2026 por distância à estação</h4><div id="trPerfD" class="chart" style="height:200px"></div></div>
    <div><h4 class="trh4">… e por zona do zoneamento</h4><div id="trPerfZ" class="chart" style="height:200px"></div><p class="note">${esc(ZONA_NOTA)}</p></div></div></div>
<div class="card"><h3>Cobertura e limites</h3><div id="trCov"></div></div>`;
R.registerView({id: 'terrenos', label: 'Terrenos', sub: 'montagem → lançamento', group: 'radar', order: 30, ids: ['tsel'], html: HTML,
  estrato: {tipos: [], dims: [], why: 'Terrenos: a base é a área de terreno (IPTU); o estrato de unidade não se aplica'},
  estratoLabel: () => 'não se aplica (base: área de terreno)',
  railNote: 'Base: área de terreno do IPTU. R$ nominais e de jul/2026 (IPCA). Permutas não aparecem: custo pode estar subestimado.',
  render: renderRadar});
const $ = id => document.getElementById(id);
function renderRadar() {
  renderCtrl();
  if (!TD.ev) {
    $('trFunnel').innerHTML = '<div class="loading">Carregando terrenos…</div>';
    loadCore().then(() => { if (R.S.view === 'terrenos') renderRadar(); if (LIC_ON) loadPor().then(() => { if (R.S.view === 'terrenos') renderRadar(); }); })
      .catch(err => { $('trFunnel').innerHTML = `<div class="empty">Dados de terrenos indisponíveis: rode <code>python3.12 build_terrenos.py</code> e abra pela URL do serve.py. (${esc(err.message || err)})</div>`; });
    return;
  }
  if (LIC_ON && !TD.por && !TD.porErr) loadPor().then(() => { if (R.S.view === 'terrenos') renderRadar(); });
  const evs = TD.ev.filter(passEv), qs = TD.rad.q.filter(passQ);
  const W = {1: qs.filter(qInWin)}; [2, 3, 4, 5].forEach(s => { W[s] = []; });
  evs.forEach(e => winStages(e).forEach(s => W[s].push(e)));
  R.safe('terrenos: seleção', () => renderSel());
  R.safe('terrenos: funil', () => renderFunnel(W));
  R.safe('terrenos: kpis', () => renderKpis(W, evs));
  R.safe('terrenos: mapa', () => renderTrMap(W));
  R.safe('terrenos: sinais', () => P.te >= 2 ? renderStageTable(W[P.te], P.te) : renderSignals(W[1]));
  R.safe('terrenos: preço', () => renderPrice(evs));
  if (LIC_ON) R.safe('terrenos: VGV', () => renderVgv(evs));
  R.safe('terrenos: fluxo', () => renderFlow(evs));
  R.safe('terrenos: fluxo trimestral', () => renderFlowQ());
  R.safe('terrenos: padrões', () => renderPad());
  R.safe('terrenos: cobertura', () => renderCov());
}
function renderCtrl() {
  const seg = (k, opts, lb) => `<div class="seg" data-k="${k}">${opts.map(o => `<button type="button" data-v="${o}" aria-pressed="${String(P[k]) === String(o)}">${esc(lb ? lb[o] : o)}</button>`).join('')}</div>`;
  $('trCtrl').innerHTML = `<span class="lab">Janela</span>${seg('tj', [12, 24, 36], {12: '12 m', 24: '24 m', 36: '36 m'})}` +
    `<span class="lab">Zona</span>${seg('tz', Object.keys(ZF), ZF_LB)}<span class="lab">Mín. lotes</span>${seg('tl', [1, 2, 3, 4])}` +
    (P.te ? `<button type="button" class="chip bk trclr" data-clr="te">estágio: ${esc(ST_LB[P.te])} ✕</button>` : '');
  $('trCtrl').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.clr) { P.te = 0; R.render(); return; }
    const k = b.parentElement.dataset.k; if (!k) return;
    P[k] = k === 'tz' ? b.dataset.v : +b.dataset.v; R.render();
  };
}

/* funil de estágios com as medianas entre eles */
function renderFunnel(W) {
  const M = TD.meta.medianas, A = TD.por ? TD.por.agg : null, cnt = s => W[s].length, area = s => W[s].reduce((t, x) => t + (x.a || 0), 0);
  const mx = Math.max(1, ...STAGES.map(cnt));
  const gap = (lb, m) => m && m[0] != null ? `<div class="trgap">↓ ${esc(lb)}: mediana <b>${fI(m[0])} meses</b> <span class="muted">(IQR ${fI(m[1])} a ${fI(m[2])}; n=${nf0.format(m[3])})</span></div>` : '';
  const row = s => `<button type="button" class="trfrow${P.te === s ? ' on' : ''}" data-s="${s}" title="${esc(ST_SUB[s])}: clique para filtrar mapa e tabela">
      <span class="lb">${glyph(s)} ${esc(ST_LB[s])}</span><span class="n">${nf0.format(cnt(s))}</span>
      <span class="a">${area(s) ? nf0.format(area(s) / 1000) + ' mil m²' : ''}</span><span class="bar st${s}" style="width:${Math.max(1.5, cnt(s) / mx * 100)}%"></span></button>`;
  const lu = TD.por ? TD.ev.filter(e => e.lanc != null && e.du != null && e.st0 === 5 && e.k !== 3).map(e => e.du - e.lanc) : [];
  const luq = lu.length >= 20 ? [med(lu), qt(lu, .25), qt(lu, .75), lu.length] : null;
  $('trFunnel').innerHTML = row(1) + gap('última compra → lote unificado no IPTU', M.compra_unif) + row(2) +
    (A && A.mcl[0] != null ? `<div class="trgap">↓ última compra → lançamento (${esc(FONTE)}): mediana <b>${fI(A.mcl[0])} meses</b> <span class="muted">(n=${nf0.format(A.mcl[1])})</span> ${LIC}</div>` : gap('lote unificado → 1ª guia de planta (vem perto das chaves)', M.unif_planta)) +
    (LIC_ON ? row(3) : '') + row(4) + (luq ? gap(`lançamento (${FONTE}) → unidades no IPTU`, luq) : gap('lote unificado → unidades no IPTU', M.unif_unid)) + row(5) +
    `<p class="note">${TD.porErr ? `${esc(FONTE)} indisponível: S3 fica vazio e S4 conta só a 1ª guia de planta (ITBI), que vem ~33 meses depois do lançamento. ` : ''}S1 são quadras com sinal A+ (compras até jul/2026${P.tj === 36 ? '; o sinal usa no máximo 24 meses de compras' : ''}); S2 e S5 contam exercícios do IPTU (${YB - P.tj / 12 + 1}–${YB})${LIC_ON ? `; S3 é a foto atual da ${esc(FONTE)}` : ''}. Preço pago: ${esc(PERMUTA.toLowerCase())}</p>`;
  $('trFunnel').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; const s = +b.dataset.s; P.te = P.te === s ? 0 : s; R.render(); };
  $('trFunSub').textContent = `Últimos ${P.tj} meses até 07/08/2026 · zona ${ZF_LB[P.tz]} · ≥ ${P.tl} lote${P.tl > 1 ? 's' : ''} · um evento conta em cada estágio em que entrou na janela.`;
}
function renderKpis(W, evs) {
  const pr = evs.filter(e => e.rs != null), rs = q3(pr.map(e => e.rs)), pm = q3(pr.map(e => e.pm));
  const tv = TD.por ? q3(evs.flatMap(e => e.refs.map(r => TD.por.refs[r].tv)).filter(v => v != null)) : null;
  $('trKpis').innerHTML = [
    R.kpi('Sinais A+ (quadras)', nf0.format(W[1].length), `${nf0.format(W[1].reduce((t, q) => t + q.n, 0))} lotes comprados · acerta ~17%`),
    R.kpi('R$/m² de terreno pago', rs ? fRs(rs[1]) : '—', rs ? `IQR ${nf0.format(rs[0])}–${nf0.format(rs[2])} · n=${rs[3]} · R$ jul/26` : 'sem evento com preço'),
    R.kpi('Prêmio sobre o mercado', pm ? fX(pm[1]) : '—', pm ? `IQR ${nf2.format(pm[0])}–${nf2.format(pm[2])} · valor/VVR ÷ distrito` : ''),
  ].concat(LIC_ON ? [R.kpi('Terreno ÷ VGV', tv ? nf1.format(tv[1]) + '%' : '—', tv ? `IQR ${nf0.format(tv[0])}–${nf0.format(tv[2])}% · n=${tv[3]} · ${FONTE} uso interno` : TD.porErr ? `${FONTE} indisponível` : `carregando ${FONTE}…`)] : []).join('');
}

/* mapa próprio do radar: mesma gramática da camada da Cidade, filtrado pela janela */
let MT = null; const MTS = {fit: null, key: ''};
function renderTrMap(W) {
  if (!MT) { MT = R.createBaseMap($('trMap'), {layers: {predios: 'off', lotes: 'off'}, onStyle: () => drawTrMap()}); if (MT) R.wireMap(MT, {layers: () => HIT, tip: featTip, click: featClick}); if (MT) MT.map.on('moveend', () => trPolys()); }
  MTS.W = W; drawTrMap();
  $('trMapLeg').innerHTML = STAGES.map(s => `<span class="it">${glyph(s)}${esc(ST_LB[s])}</span>`).join('') +
    `<label class="it"><input type="checkbox" id="trBc"${P.bc ? ' checked' : ''}> <span class="tdot"></span> densidade B/C: lotes com sinal fraco (≤ 7%), círculo ∝ nº de lotes</label>` +
    `<span class="it muted">centróides no zoom 11–13, lotes ≥ 13 · distritos neutros · ${esc(ZF_LB[P.tz])} · ≥ ${P.tl} lotes</span>`;
  $('trBc').onchange = e => { P.bc = e.target.checked; drawTrMap(); };
}
function drawTrMap() {
  const H = MT; if (!H || !H.ready || !TD.ev || !MTS.W) return;
  const map = H.map, W = MTS.W, below = R.firstSymbol(map);
  addTrLayers(map, below);
  const te = P.te, evs = [...new Set([2, 3, 4, 5].filter(s => !te || te === s).flatMap(s => W[s]))], qs = !te || te === 1 ? W[1] : [];
  MTS.evOk = new Set(evs.map(e => e.id)); MTS.qOk = new Set(qs.map(q => q.id));
  map.getSource('app-terrenos-pts').setData(evFeatures(evs, qs));
  map.getSource('app-terrenos-bc').setData(bcFeatures());
  R.visL(map, LIDS.bc, P.bc);
  const sel = selObj();
  map.getSource('app-terrenos-sel').setData(sel && sel.geom ? {type: 'Feature', geometry: sel.geom, properties: {}} : R.EMPTY_FC);
  MTS.key = ''; trPolys();
  const fitKey = (sel ? sel.id : '') + '|' + P.tz;
  if (MTS.fit !== fitKey) {
    MTS.fit = fitKey;
    if (sel) H.fit({center: sel.c, zoom: 15.2, pitch: 0, bearing: 0});
    else H.fit({bounds: [[-46.74, -23.65], [-46.55, -23.50]], padding: 8, maxZoom: 12.2, pitch: 0, bearing: 0});
  }
}
function trPolys() {
  const H = MT; if (!H || !H.ready || !TD.ev || H.map.getZoom() < 12.5) return;
  const cds = cdsInView(H.map, 6);
  Promise.allSettled(cds.map(loadGeo)).then(() => {
    const key = cds.join(',') + '|' + TD.ver + '|' + MTS.evOk.size + '|' + MTS.qOk.size + P.te + P.tj + P.tz + P.tl; if (key === MTS.key) return; MTS.key = key;
    const s = H.map.getSource('app-terrenos-pol'); if (s) s.setData(polyFeatures(cds, e => MTS.evOk.has(e.id), q => MTS.qOk.has(q.id)));
    const sel = selObj(); if (sel && sel.geom === undefined) { const g = H.map.getSource('app-terrenos-sel'); const s2 = selObj(); if (g && s2 && s2.geom) g.setData({type: 'Feature', geometry: s2.geom, properties: {}}); }
  });
}

/* seleção: evento (E…) ou quadra com sinal (Q…) */
function selObj() {
  const id = R.S.tsel; if (!id || !TD.ev) return null;
  if (id[0] === 'Q') { const q = TD.rad.byId[id]; if (!q) return null; const G = TD.geo[q.cd], d = G && G.sq[id];
    return {id, q, c: q.c, cd: q.cd, geom: d ? {type: 'MultiPolygon', coordinates: d.l.filter(l => l[6] && l[6].length).flatMap(l => R.decodeRings(l[6]).map(r => [r]))} : undefined}; }
  const e = TD.byId[id]; if (!e) return null; const d = evDet(e);
  return {id, e, c: e.c, cd: e.cd, geom: d ? (d.g.length ? ringsGeom(d.g) : null) : undefined};
}
function renderSel() {
  const el = $('trSel'), id = R.S.tsel;
  if (!id) { el.hidden = true; return; }
  el.hidden = false;
  const s = selObj();
  if (!s) { el.innerHTML = `<div class="empty">Evento ou quadra <b>${esc(id)}</b> não encontrado nos dados de terrenos. <button type="button" class="linkbtn" data-x>fechar</button></div>`; el.querySelector('[data-x]').onclick = () => R.setView('terrenos', {tsel: null}); return; }
  if (!TD.geo[s.cd]) { el.innerHTML = '<div class="loading">Carregando o detalhe…</div>'; loadGeo(s.cd).then(() => { if (R.S.view === 'terrenos') { renderSel(); drawTrMap(); } }).catch(() => { el.innerHTML = '<div class="empty">Detalhe indisponível (terrenos/geo).</div>'; }); return; }
  el.innerHTML = s.q ? quadraCard(s.q) : eventCard(s.e, {close: true});
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.x != null) R.setView('terrenos', {tsel: null});
    else if (b.dataset.lot) R.openLot(b.dataset.cd, b.dataset.lot);
    else if (b.dataset.ref) R.setView('lancamento', {ref: b.dataset.ref});
    else if (b.dataset.ev) R.setView('terrenos', {tsel: b.dataset.ev});
  };
}
/* linha do tempo S1…S5 de um evento, com a fonte e a precisão de cada data */
function timeline(e, d) {
  const refs = TD.por ? e.refs.map(r => TD.por.refs[r]) : [];
  const lanc = refs.map(r => r.lanc).filter(Boolean).sort()[0];
  const c1 = d && d.c1 ? mYM(d.c1) : null;
  const st = [
    [1, e.c2 != null ? `compras ${c1 != null && c1 !== e.c2 ? fMo(c1) + ' → ' : ''}${fMo(e.c2)}` : e.ob ? 'compra não identificada' : 'fora da cobertura do ITBI', 'ITBI'],
    [2, e.s2 ? `IPTU ${e.s2} (± 12 m)${d && d.dm ? ' · início de vida ' + fMo(mYM(d.dm)) : ''}` : e.tp === 'U' ? 'sem lote-mãe visível (84% vão direto a condomínio)' : '—', 'IPTU'],
    [3, e.st3 ? `oferta futura (${FONTE})` : '—', FONTE],
    [4, [lanc ? `lançado ${fMo(mYM(lanc))} (${FONTE})` : null, e.pl != null ? `1ª guia de planta ${fMo(e.pl)}` : null].filter(Boolean).join(' · ') || '—', lanc ? `${FONTE} + ITBI` : 'ITBI'],
    [5, e.st0 === 5 ? `condomínio no IPTU ${e.tu}${e.du != null ? ' · unidades desde ' + fMo(e.du) : ''}` : '—', 'IPTU'],
  ].filter(([s]) => STAGES.includes(s));
  return `<div class="trtl">${st.map(([s, t, f]) => `<div class="trtl-s${e.st >= s || (s === 1 && e.c2 != null) ? ' on' : ''}${e.st === s ? ' cur' : ''}"><span class="h">${glyph(s)} ${esc(ST_LB[s])}</span><span class="t">${esc(t)}</span><span class="f">${esc(f)}</span></div>`).join('')}</div>`;
}
function eventCard(e, opt = {}) {
  const d = evDet(e) || {}, refs = TD.por ? e.refs.map(r => [r, TD.por.refs[r]]) : [];
  const tv = refs.map(([, r]) => r.tv).filter(v => v != null);
  const casas = TD.meta.casas[e.cd];
  const head = `<div class="trsel-h"><div><span class="eyebrow">${esc(TP_LB[e.tp])}${e.k != null ? ' · ' + esc(K_LB[e.k]) : ''}</span>
      <h3>${esc(d.end || 'Quadra ' + sqLb(e.id.slice(1, 7)))}</h3><span class="meta">${esc(R.dname(e.cd))} · quadra fiscal ${sqLb(e.id.slice(1, 7))} · evento ${esc(e.id)} · balanço de área ${esc(Q_LB[d.q] || '—')}${d.ec ? ' · ' + esc(EC_LB[d.ec] || d.ec) : ''}</span></div>
    <div class="trsel-b">${e.tp !== 'N' && d.lid ? `<button type="button" class="linkbtn" data-cd="${esc(e.cd)}" data-lot="${esc(d.lid)}">Prédio / lote →</button>` : ''}
      ${refs.length && R.viewDef('lancamento') ? refs.slice(0, 3).map(([r, x]) => `<button type="button" class="badge-link" data-ref="${esc(r)}">${esc(x.nome || 'Ref. ' + r)} →</button>`).join('') : ''}
      ${opt.close ? '<button type="button" class="linkbtn" data-x>✕ fechar</button>' : ''}</div></div>`;
  const kp = [
    R.kpi('Lotes de origem', nf0.format(e.nl), `${fM2(e.a)} de terreno${d.aa ? ' · novo ' + fM2(d.aa) : ''}`),
    R.kpi('Unidades (IPTU)', e.un ? nf0.format(e.un) : '—', d.pv ? d.pv + ' pavimentos' : e.st0 === 5 ? '' : 'ainda sem condomínio'),
    R.kpi('Pago pelo terreno', e.vn != null ? fMoney(e.vn) : '—', e.vn != null ? `${fMoney(e.vr)} em R$ jul/26 · ${e.nc} de ${e.nl} lotes` : esc(priceTxt(e))),
    R.kpi('R$/m² de terreno', e.rs != null ? fRs(e.rs) : '—', e.rs != null && casas ? `casas do distrito ${nf0.format(casas[1])} (${nf2.format(e.rs / casas[1])}×)` : ''),
    R.kpi('Prêmio sobre o mercado', e.pm != null ? fX(e.pm) : '—', e.pm != null ? `valor/VVR ÷ mediana do distrito · n=${d.pmn || '—'}` : ''),
  ].concat(LIC_ON ? [R.kpi('Terreno ÷ VGV', tv.length ? nf1.format(med(tv)) + '%' : '—', tv.length ? `${FONTE} · uso interno` : TD.porErr ? `${FONTE} indisponível` : refs.length ? 'sem custo ou VGV' : `sem Referência ${FONTE}`)] : []).join('');
  const cps = (d.cp || []);
  const est = d.es ? `<p class="note">Estimado para o terreno inteiro (R$/m² × área de origem): <b>${fMoney(d.es)}</b> em R$ jul/26 — compra observada em ${e.nc} de ${e.nl} lotes.</p>` : '';
  const why = e.rs == null ? `<p class="note"><b>Sem preço:</b> ${esc(priceTxt(e))}.</p>` : '';
  const compras = cps.length ? `<table class="t"><thead><tr><th>Data</th><th>SQL</th><th class="n">Valor</th><th class="n">R$ jul/26</th><th class="n">Prop.</th><th>Natureza</th><th class="n">Prêmio</th></tr></thead><tbody>${
    cps.map(c => `<tr><td>${fDay(c[0])}</td><td>${sqlLb(c[1])}</td><td class="n">${fMoney(c[2])}</td><td class="n">${fMoney(c[3])}</td><td class="n">${c[4] != null ? nf0.format(c[4]) + '%' : '—'}</td><td>${esc(NAT[c[5]] || c[5])}${c[6] ? ' · financ.' : ''}</td><td class="n">${c[7] != null ? fX(c[7] / 100) : '—'}</td></tr>`).join('')}</tbody></table>` : '';
  const lotes = (d.f || []).length ? `<table class="t"><thead><tr><th>SQL de origem</th><th>Endereço</th><th class="n">Terreno</th><th>Uso</th><th class="n">ACC</th><th class="n">Sai do IPTU</th></tr></thead><tbody>${
    d.f.map(f => `<tr><td>${sqlLb(f[0])}</td><td class="wrap">${esc(f[2] || '—')}</td><td class="n">${fM2(f[1])}</td><td>${esc(f[3] || '—')}</td><td class="n">${f[4] || '—'}</td><td class="n">${f[5] || '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="sub">Lista de lotes de origem indisponível.</p>';
  return head + timeline(e, d) + `<div class="kpis trkp">${kp}</div>` +
    `<div class="trsel-g"><div>${miniSvg(d)}<p class="note">Cheio: lote/condomínio de 2026${(d.o || []).length ? ' · tracejado: lote de origem que ainda tem polígono' : ' · os lotes de origem não têm polígono (a camada histórica não existe)'}.</p></div>
      <div><h4 class="trh4">Compras dos lotes (ITBI)</h4>${compras || why}${est}${e.rs != null ? `<p class="note">${esc(PERMUTA)} Naturezas: ${esc(d.nat || '—')}.</p>` : ''}
      <h4 class="trh4">Lotes que formaram o terreno (IPTU)</h4><div class="tablewrap" style="max-height:220px;overflow:auto">${lotes}</div></div></div>`;
}
const Q_LB = {A: '±5%', B: '±10%', C: '±25%', D: 'fora de ±25%'};
const EC_LB = {ok: 'endereço conferido', sem_numero: 'sem número no cadastro', codlog_diferente: 'rua do novo ≠ das origens (esquina?)', fora_da_faixa: 'número fora da faixa das origens'};
const NAT = {1: 'compra e venda', 2: 'cessão', 12: 'dação', 15: 'permuta', 20: 'integraliz. capital', 21: 'incorporação PJ', 23: 'cisão', 33: 'demais atos onerosos', 40: 'excesso integraliz.'};
function quadraCard(q) {
  const d = TD.geo[q.cd] && TD.geo[q.cd].sq[q.id], lots = d ? d.l : [];
  const e2 = q.s2 && TD.byId[q.s2];
  const head = `<div class="trsel-h"><div><span class="eyebrow">${glyph(1)} Sinal A+ · não é incorporação confirmada</span><h3>Quadra ${sqLb(q.id.slice(1))}${q.rua ? ' · ' + esc(q.rua.replace(/\s+/g, ' ')) : ''}</h3>
      <span class="meta">${esc(R.dname(q.cd))} · ${esc(q.zn || 'sem zona')}${q.ca ? ' · CA máx. ' + nf1.format(q.ca) : ''} · estação a ${q.de != null ? nf0.format(q.de) + ' m' : '—'}</span></div>
    <div class="trsel-b">${e2 ? `<button type="button" class="linkbtn" data-ev="${esc(e2.id)}">lote unificado na quadra (S2) →</button>` : ''}<button type="button" class="linkbtn" data-x>✕ fechar</button></div></div>`;
  const kp = [
    R.kpi('Lotes comprados (24 m)', nf0.format(q.n), `${nf0.format(q.nA)} com sinal A+ · ${fM2(q.a)}`),
    R.kpi('Pago', fMoney(q.vn), `${fMoney(q.vr)} em R$ jul/26`),
    R.kpi('R$/m² de terreno', fRs(q.rs), TD.meta.casas[q.cd] ? `casas do distrito ${nf0.format(TD.meta.casas[q.cd][1])}` : ''),
    R.kpi('Prêmio (mediana)', fX(q.pm), `máx. ${fX(q.pmx)} · valor/VVR ÷ distrito`),
    R.kpi('Face de quadra', q.face != null ? nf0.format(q.face * 100) + '%' : '—', 'lotes comprados na mesma rua'),
    R.kpi('Última compra', fMo(q.u2), `desde ${fMo(q.u1)} · há ${fI(q.rec)} meses`),
  ].join('');
  const tb = lots.length ? `<table class="t"><thead><tr><th>SQL</th><th class="n">Terreno</th><th>Última compra</th><th class="n">Valor</th><th class="n">Prêmio</th><th>Nível</th></tr></thead><tbody>${
    lots.slice().sort((a, b) => (b[2] || 0) - (a[2] || 0)).map(l => `<tr><td>${sqlLb(l[0])}</td><td class="n">${fM2(l[1])}</td><td>${fDay(l[2])}</td><td class="n">${fMoney(l[3])}</td><td class="n">${l[4] != null ? fX(l[4] / 100) : '—'}</td><td>${esc(l[5])}</td></tr>`).join('')}</tbody></table>` : '';
  return head + `<div class="kpis trkp">${kp}</div><div class="trsel-g"><div>${miniSvg({g: [], sq: lots})}<p class="note">Pontilhado: lotes comprados em 24 m (polígono 2026).</p>${sigBars(q, true)}</div>
    <div><h4 class="trh4">Lotes comprados na quadra (ITBI, ago/2024–jul/2026)</h4><div class="tablewrap" style="max-height:260px;overflow:auto">${tb}</div>
    <p class="note">No backtest (t0 = dez/2021, desfecho em 2–4 anos) o nível A+ acerta ${esc(btTxt())} das incorporações. ${esc(PERMUTA)}</p></div></div>`;
}
/* minimapa em SVG (sem outro contexto WebGL): novo cheio, origem tracejada, lotes do sinal pontilhados */
function miniSvg(d, w = 300, h = 200) {
  const shapes = [];
  (d.g && d.g.length ? [ringsGeom(d.g)] : []).forEach(g => shapes.push({g, cls: 'new'}));
  (d.o || []).forEach(o => o.length && shapes.push({g: ringsGeom(o), cls: 'old'}));
  (d.sq || []).forEach(l => l[6] && l[6].length && shapes.push({g: ringsGeom(l[6]), cls: 'sig'}));
  if (!shapes.length) return '<div class="trmini empty">sem polígono 2026 (centróide da quadra)</div>';
  const rings = s => (s.g.type === 'Polygon' ? [s.g.coordinates[0]] : s.g.coordinates.map(p => p[0]));
  const all = shapes.flatMap(s => rings(s).flat());
  const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])), y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
  const kx = Math.cos((y0 + y1) / 2 * Math.PI / 180), sx = (x1 - x0) * kx || 1e-5, sy = (y1 - y0) || 1e-5, sc = Math.min((w - 20) / sx, (h - 20) / sy);
  const P2 = p => [10 + (p[0] - x0) * kx * sc + ((w - 20) - sx * sc) / 2, h - 10 - (p[1] - y0) * sc - ((h - 20) - sy * sc) / 2];
  const meters = Math.max(sx * 111320, sy * 110540);
  const path = s => rings(s).map(r => 'M' + r.map(p => P2(p).map(v => v.toFixed(1)).join(' ')).join('L') + 'Z').join('');
  return `<svg class="trmini" viewBox="0 0 ${w} ${h}" role="img" aria-label="Forma do terreno">${shapes.map(s => `<path class="${s.cls}" d="${path(s)}"/>`).join('')}<text x="${w - 8}" y="${h - 6}" text-anchor="end">~${nf0.format(meters)} m</text></svg>`;
}

/* tabela de sinais A+ com a decomposição do sinal em mini-barras */
const COMP = [
  ['lotes', 'nº de lotes comprados na quadra', q => clamp((q.n - 1) / 5, 0, 1), q => `${q.n} lotes`],
  ['face', 'fração da face de quadra (mesma rua) comprada', q => q.face || 0, q => q.face != null ? nf0.format(q.face * 100) + '%' : '—'],
  ['eixo', 'zona de eixo (ZEU/ZEM = cheio; previsto = meio)', q => q.z === 'E' ? 1 : q.z === 'P' ? .5 : 0, q => q.zn || 'sem zona'],
  ['metrô', 'distância à estação (≤ 400 m = cheio; ≥ 1,5 km = vazio)', q => q.de == null ? 0 : clamp(1 - (q.de - 400) / 1100, 0, 1), q => q.de != null ? nf0.format(q.de) + ' m' : '—'],
  ['prêmio', 'prêmio pago sobre o mercado (1× = vazio; 2,5× = cheio)', q => q.pm == null ? 0 : clamp((q.pm - 1) / 1.5, 0, 1), q => fX(q.pm)],
  ['recente', 'meses desde a última compra (0 = cheio; 24 = vazio)', q => q.rec == null ? 0 : clamp(1 - q.rec / 24, 0, 1), q => q.rec != null ? nf0.format(q.rec) + ' meses' : '—'],
];
function sigBars(q, wide) {
  const t = COMP.map(c => `${c[0]}: ${c[3](q)}`).join(' · ');
  return `<span class="trbars${wide ? ' wide' : ''}" title="${esc(t)}" aria-label="${esc(t)}">${COMP.map(c => `<i style="--v:${(c[2](q) * 100).toFixed(0)}%"${wide ? ` data-l="${esc(c[0])}"` : ''}></i>`).join('')}</span>`;
}
function renderSignals(qs) {
  $('trSig').closest('.card').querySelector('h3').innerHTML = 'Sinais em curso · A+ por quadra';
  const b = TD.meta.bt['2021:S6_viz_premio_eixo'] || {}, b3 = TD.meta.bt['2022:S3_viz_premio'] || {};
  $('trSigSub').innerHTML = `Quadras com lotes vizinhos comprados em 24 meses, prêmio ≥ 1,25× o mercado do distrito e em eixo ou a ≤ 800 m de estação. ` +
    `<b>Backtest</b> (t0 = dez/2021, desfecho em 2–4 anos): <b>acerta ${nf1.format(b.precisao || 16.9)}%</b>, ${nf1.format(b.lift || 35.5)}× a taxa-base de ${nf2.format(b.base || .48)}%; <b>encontra ${nf1.format(b.recall || 9.6)}%</b> das incorporações ` +
    `(com t0 = dez/2022 o nível sem eixo cai a ${nf1.format(b3.precisao || 5.7)}%). "Sinal" não é incorporação em curso. ${qs.length > 400 ? 'Mostrando 400 de ' + nf0.format(qs.length) + '.' : nf0.format(qs.length) + ' quadras.'} Barras: ${COMP.map(c => c[0]).join(' · ')}. ${esc(PERMUTA)}`;
  const rows = qs.slice().sort((a, b) => b.nA - a.nA || b.n - a.n).slice(0, 400);
  R.table($('trSig'), 'trsig', [
    {k: 'id', label: 'Quadra', cls: 'wrap', sv: r => r.id, f: r => `<button class="linkbtn" type="button">${sqLb(r.id.slice(1))}</button> <span class="qtag">${esc(R.dname(r.cd))}</span>${r.rua ? `<div class="qtag" style="margin:0">${esc(r.rua.replace(/\s+/g, ' '))}</div>` : ''}`},
    {k: 'nA', label: 'Lotes A+', n: 1, title: 'lotes com sinal A+ na quadra (vizinhos, prêmio ≥ 1,25×, eixo ou estação ≤ 800 m)'},
    {k: 'n', label: 'Comprados', n: 1, title: 'todos os lotes comprados (compra integral) na quadra em 24 m, com sinal A+ a C'},
    {k: 'a', label: 'Área', n: 1, f: r => fM2(r.a)},
    {k: 'vr', label: 'Pago', n: 1, title: 'nominal · R$ de jul/2026 (IPCA)', f: r => `${fMoney(r.vn)}<div class="qtag" style="margin:0">${fMoney(r.vr)} IPCA</div>`},
    {k: 'rs', label: 'R$/m² terr.', n: 1, f: r => r.rs != null ? nf0.format(r.rs) : '—'},
    {k: 'pm', label: 'Prêmio', n: 1, title: 'valor/VVR ÷ mediana das compras integrais de lotes no distrito e ano (mediana dos lotes · máx.)', f: r => `${fX(r.pm)}<span class="qtag">máx ${fX(r.pmx)}</span>`},
    {k: 'zn', label: 'Zona · CA', f: r => `${esc(Z_LB[r.z] || '—')}${r.ca ? ` <span class="qtag">CA ${nf1.format(r.ca)}</span>` : ''}`},
    {k: 'de', label: 'Estação', n: 1, f: r => r.de != null ? nf0.format(r.de) + ' m' : '—'},
    {k: 'u2', label: 'Última', n: 1, f: r => fMo(r.u2)},
    {k: 'st', label: 'Estágio', sv: r => r.s2 ? 2 : 1, f: r => r.s2 ? `${glyph(2, 16)} S2` : `${glyph(1, 16)} S1`},
    {k: 'bars', label: 'Por quê', sort: false, f: r => sigBars(r)},
  ], rows, {sort: {k: 'nA', d: 'desc'}, sel: r => r.id === R.S.tsel, onRow: r => R.setView('terrenos', {tsel: r.id})});
}

/* tabela de eventos de um estágio na janela (quando o funil filtra S2–S5) */
function renderStageTable(evs, st) {
  const card = $('trSig').closest('.card'); card.querySelector('h3').innerHTML = `${glyph(st)} Eventos que entraram em ${esc(ST_LB[st])} na janela`;
  $('trSigSub').innerHTML = `${nf0.format(evs.length)} eventos (${esc(ST_SUB[st])}), últimos ${P.tj} meses · zona ${esc(ZF_LB[P.tz])} · ≥ ${P.tl} lotes. ${st === 2 || st === 5 ? 'Data do IPTU: vintage anual (± 12 m). ' : ''}Preço só para lotes extintos a partir de 2023; ${esc(PERMUTA.toLowerCase())} Clique para abrir.`;
  const when = e => st === 2 ? e.s2 : st === 5 ? e.tu : st === 4 ? (e.lanc != null ? e.lanc : e.pl) : null;
  R.table($('trSig'), 'trst' + st, [
    {k: 'id', label: 'Evento', cls: 'wrap', f: r => `<button class="linkbtn" type="button">${esc(TP_LB[r.tp])}</button> <span class="qtag">${esc(R.dname(r.cd))} · quadra ${sqLb(r.id.slice(1, 7))}</span>`},
    {k: 'w', label: 'Quando', n: 1, sv: when, f: r => { const w = when(r); return w == null ? (st === 3 ? `${esc(FONTE)} (foto)` : '—') : st === 4 ? fMo(w) + (r.lanc != null ? ` <span class="qtag">${esc(FONTE)}</span>` : ' <span class="qtag">planta</span>') : 'IPTU ' + w; }},
    {k: 'nl', label: 'Lotes', n: 1}, {k: 'a', label: 'Terreno', n: 1, f: r => fM2(r.a)}, {k: 'un', label: 'Unid.', n: 1, f: r => r.un != null ? nf0.format(r.un) : '—'},
    {k: 'vr', label: 'Pago (R$ jul/26)', n: 1, f: r => r.vr != null ? fMoney(r.vr) : `<span class="gray" title="${esc(priceTxt(r))}">${r.ob ? 'sem compra' : 'sem registro'}</span>`},
    {k: 'rs', label: 'R$/m² terr.', n: 1, f: r => r.rs != null ? nf0.format(r.rs) : '—'}, {k: 'pm', label: 'Prêmio', n: 1, f: r => fX(r.pm)},
    {k: 'z', label: 'Zona', f: r => esc(Z_LB[r.z])}, {k: 'k', label: 'Tipo de montagem', f: r => esc(K_LB[r.k] || '—')},
  ], evs.slice().sort((a, b) => (b.a || 0) - (a.a || 0)).slice(0, 400), {sort: {k: 'a', d: 'desc'}, sel: r => r.id === R.S.tsel, onRow: r => R.setView('terrenos', {tsel: r.id})});
}
/* preço pago: R$/m² de terreno por evento contra a faixa (IQR) das casas do distrito */
function renderPrice(evs) {
  const pts = evs.filter(e => e.rs != null), C = TD.meta.casas;
  const cds = [...new Set(pts.map(e => e.cd))].filter(cd => C[cd]).sort((a, b) => C[a][1] - C[b][1]);
  const yi = Object.fromEntries(cds.map((cd, i) => [cd, i]));
  const h = Math.max(260, 50 + cds.length * 17);
  $('trPrice').style.height = h + 'px';
  const c = R.chart('trPrice'); if (!c) return; c.resize();
  const ink = css('--ink'), s1 = css('--s1');
  const all = pts.map(e => e.rs).concat(cds.flatMap(cd => [C[cd][0], C[cd][2]])).filter(v => v > 0);
  const lo = Math.max(100, (qt(all, 0.005) || 500) * 0.8), hi = (qt(all, 0.995) || 50000) * 1.2;
  c.setOption(Object.assign(R.base(), {
    grid: {left: 150, right: 18, top: 10, bottom: 40},
    xAxis: R.ax({type: 'log', min: lo, max: hi, name: 'R$/m² de terreno (R$ de jul/2026, escala log)', nameLocation: 'middle', nameGap: 26, axisLabel: {formatter: v => nf0.format(v)}}),
    yAxis: R.ax({type: 'category', data: cds.map(R.dname), splitLine: {show: false}, axisLabel: {fontSize: 10, color: css('--ink-2')}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => {
      if (p.seriesName === 'casas') { const cd = cds[p.data[2]], k = C[cd]; return R.tip(`Casas · ${R.dname(cd)}`, [['R$/m² de terreno (mediana)', nf0.format(k[1])], ['IQR', `${nf0.format(k[0])}–${nf0.format(k[2])}`], ['n (compras integrais 2019–2026)', nf0.format(k[3])]], 'residências compradas inteiras; R$ de jul/2026'); }
      const e = TD.ev[p.data[2]], k = C[e.cd];
      return R.tip(TP_LB[e.tp], [['Distrito', R.dname(e.cd)], ['R$/m² de terreno', fRs(e.rs)], ['÷ casas do distrito (mediana)', k ? fX(e.rs / k[1]) : '—'],
        ['Pago', `${fMoney(e.vn)} · ${fMoney(e.vr)} R$ jul/26`], ['Lotes · área', `${e.nl} · ${fM2(e.a)}`], ['Prêmio (valor/VVR)', fX(e.pm)], ['Última compra', fMo(e.c2)], ['Estágio', ST_LB[e.st]]], PERMUTA + ' Clique para abrir.');
    }}),
    series: [
      {name: 'casas', type: 'custom', z: 1, data: cds.map((cd, i) => [C[cd][0], C[cd][2], i, C[cd][1]]), encode: {x: [0, 1], y: 2}, renderItem: (pr, api) => {
        const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), api.value(2)]), m = api.coord([api.value(3), api.value(2)]);
        return {type: 'group', children: [{type: 'rect', shape: {x: a[0], y: a[1] - 5, width: Math.max(1, b[0] - a[0]), height: 10}, style: {fill: s1, opacity: 0.2}},
          {type: 'line', shape: {x1: m[0], y1: m[1] - 6, x2: m[0], y2: m[1] + 6}, style: {stroke: s1, lineWidth: 2}}]};
      }},
      {name: 'eventos', type: 'scatter', z: 3, symbolSize: 7, data: pts.filter(e => yi[e.cd] != null).map(e => ({value: [e.rs, yi[e.cd] + (((e.i * 7919) % 11) - 5) / 26, e.i],
        itemStyle: {color: e.id === R.S.tsel ? css('--pl') : ink, opacity: 0.8, borderColor: css('--surface'), borderWidth: 0.6}})), yAxisIndex: 0},
    ],
  }), true);
  c.off('click'); c.on('click', p => { if (p.seriesName === 'eventos') R.setView('terrenos', {tsel: TD.ev[p.data.value[2]].id}); });
  const nd = pts.filter(e => !C[e.cd]).length;
  $('trPriceSub').textContent = `Cada ponto é um evento com preço medido (${nf0.format(pts.length)}): lotes extintos a partir de 2023 com compra identificada em ≥ 50% deles. Faixa azul = IQR do R$/m² de terreno das casas do distrito (compras integrais 2019–2026) e o traço, a mediana. Anteriores a 2023: ${F6}.`;
  $('trPriceLeg').innerHTML = `<span class="it"><i class="dot" style="background:var(--ink)"></i>evento (R$/m² de terreno pago)</span><span class="it"><i class="dot" style="border-radius:2px;background:var(--s1);opacity:.35"></i>casas do distrito: IQR · mediana</span><span class="it muted">${esc(PERMUTA)}${nd ? ` · ${nd} sem faixa de casas` : ''}</span>`;
}

/* terreno × lançamento (fonte licenciada, uso interno; o cartão só existe com ela): log-log com iso-linhas do peso do terreno no VGV */
function renderVgv(evs) {
  const c = R.chart('trVgv'); if (!c) return;
  if (!TD.por) { c.clear(); $('trVgvSub').innerHTML = TD.porErr ? `${esc(FONTE)} indisponível (terrenos/${esc(R.licenciado.por_ref)} não carregou): este painel usa dado licenciado e só roda localmente pelo serve.py.` : `Carregando ${esc(FONTE)}…`; $('trVgvLeg').innerHTML = ''; return; }
  const ok = new Set(evs.map(e => e.id));
  const pts = Object.entries(TD.por.refs).filter(([, r]) => r.tpriv && r.tab && ok.has(r.ev)).map(([ref, r]) => ({ref, r, e: TD.byId[r.ev]}));
  if (!pts.length) { c.clear(); $('trVgvSub').textContent = `Nenhuma Referência ${FONTE} com custo de terreno e VGV nos filtros atuais.`; $('trVgvLeg').innerHTML = LIC; return; }
  const xs = pts.map(p => p.r.tpriv), ys = pts.map(p => p.r.tab);
  const xlo = Math.max(50, (Math.min(...xs) || 300) * 0.8), xhi = (Math.max(...xs) || 20000) * 1.2, ylo = Math.max(500, (Math.min(...ys) || 2000) * 0.8), yhi = (Math.max(...ys) || 40000) * 1.25;
  const seg = p => { const a = Math.max(xlo, ylo * p), b = Math.min(xhi, yhi * p); return a < b ? [{coord: [a, a / p]}, {coord: [b, b / p]}] : null; };
  const iso = {name: 'iso', type: 'line', data: [], silent: true, markLine: {silent: true, symbol: 'none', lineStyle: {color: css('--axis'), width: 1, type: [4, 3]},
    label: {position: 'insideEndTop', color: css('--ink-2'), fontSize: 10.5, fontWeight: 600, formatter: p => p.name},
    data: [0.10, 0.15, 0.20, 0.25].map(p => { const g = seg(p); return g ? [Object.assign({name: nf0.format(p * 100) + '%'}, g[0]), g[1]] : null; }).filter(Boolean)}};
  const tv = q3(pts.map(p => p.r.tv));
  c.setOption(Object.assign(R.base(), {
    grid: {left: 64, right: 40, top: 14, bottom: 42},
    xAxis: R.ax({type: 'log', min: xlo, max: xhi, name: 'R$ de terreno por m² privativo vendável (R$ jul/26)', nameLocation: 'middle', nameGap: 26, axisLabel: {formatter: v => nf0.format(v)}}),
    yAxis: R.ax({type: 'log', min: ylo, max: yhi, name: 'tabela R$/m² privativo', nameLocation: 'middle', nameGap: 48, axisLabel: {formatter: v => nf0.format(v)}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { if (!p.data || !p.data.ref) return ''; const {r, ref} = p.data;
      return R.tip(`${r.nome || 'Referência'} · Ref. ${ref}`, [['Terreno ÷ VGV de tabela', r.tv != null ? nf1.format(r.tv) + '%' : '—'], ['Custo do terreno (R$ jul/26)', fMoney(r.custo)], ['VGV de tabela', `${fMoney(r.vgv)} · ${r.vcob != null ? r.vcob + '% das unid. com preço' : ''}`],
        ['Área privativa total', fM2(r.apriv)], [`Lançamento (${FONTE})`, r.lanc ? fMo(mYM(r.lanc)) : '—'], ['Última compra → lançamento', r.mcl != null ? nf0.format(r.mcl) + ' meses' : '—'], ['Status', (r.st || '').replace(/_/g, ' ')]],
      R.licenciado.selo + ' · VGV = tabela atual × unidades (proxy; subestima quando a tipologia esgotou) · ' + PERMUTA); }}),
    series: [iso, {name: 'ref', type: 'scatter', z: 3, symbolSize: 7, data: pts.map(p => { const lo = p.r.vcob != null && p.r.vcob < 80, sel = p.r.ev === R.S.tsel;
      return {value: [p.r.tpriv, p.r.tab], ref: p.ref, r: p.r, itemStyle: lo ? {color: 'transparent', borderColor: sel ? css('--pl') : css('--ink-2'), borderWidth: 1.2}
        : {color: sel ? css('--pl') : css('--ink'), opacity: 0.78, borderColor: css('--surface'), borderWidth: 0.6}}; })}],
  }), true);
  c.off('click'); c.on('click', p => { if (p.data && p.data.ref) { if (R.viewDef('lancamento')) R.setView('lancamento', {ref: p.data.ref}); else R.setView('terrenos', {tsel: p.data.r.ev}); } });
  $('trVgvSub').innerHTML = `Uma Referência ${esc(FONTE)} por ponto, ligada a um evento com preço de terreno medido (${nf0.format(pts.length)}). Na diagonal, o peso do terreno no VGV de tabela: <b>mediana ${tv ? nf1.format(tv[1]) : '—'}%</b> (IQR ${tv ? nf0.format(tv[0]) + '–' + nf0.format(tv[2]) : '—'}%). Mesma área (privativa) nos dois eixos: a razão é exata.`;
  $('trVgvLeg').innerHTML = `<span class="it"><i class="dot" style="background:var(--ink)"></i>Referência ${esc(FONTE)}</span><span class="it"><i class="dot" style="box-shadow:inset 0 0 0 1.2px var(--ink-2)"></i>VGV com &lt; 80% das unidades com preço</span><span class="it"><i class="lk" style="background:var(--axis)"></i>terreno = 10 · 15 · 20 · 25% do VGV</span>${LIC}<span class="it muted">ligação A3 por ponto (≤ 60 m) ou endereço + razão de área · ${esc(PERMUTA)}</span>`;
}

/* fluxo anual (IPTU, ± 12 m): área de origem por ano de saída do cadastro × zona; conversão das coortes de S2 */
function zoneColors() { const s = R.PALS.seq(); return {E: s[7], P: s[5], C: s[3], M: s[2], O: s[1], '': css('--gray-cell')}; }
function renderFlow(evs) {
  const c = R.chart('trFlow'); if (!c) return;
  const anos = []; for (let y = 2011; y <= YB; y++) anos.push(y);
  const zs = ZF[P.tz] || ZK, zc = zoneColors();
  const m2 = Object.fromEntries(zs.map(z => [z, anos.map(() => 0)])), n = Object.fromEntries(zs.map(z => [z, anos.map(() => 0)]));
  const b = anos.map(() => 0), cv = anos.map(() => 0), bn = anos.map(() => 0), cn = anos.map(() => 0);
  evs.forEach(e => {
    const i = anos.indexOf(e.te); if (i >= 0 && m2[e.z]) { m2[e.z][i] += e.a || 0; n[e.z][i]++; }
    const j = anos.indexOf(e.s2); if (j >= 0) { b[j] += e.a || 0; bn[j]++; if (e.st >= 4) { cv[j] += e.a || 0; cn[j]++; } }
  });
  const conv = anos.map((_, i) => bn[i] >= 10 ? cv[i] / b[i] * 100 : null);
  c.setOption(Object.assign(R.base(), {
    grid: {left: 54, right: 46, top: 18, bottom: 30},
    xAxis: R.ax({type: 'category', data: anos.map(String), axisLabel: {fontSize: 10}}),
    yAxis: [R.ax({type: 'value', name: 'mil m² de terreno', nameGap: 8, nameTextStyle: {align: 'left'}, axisLabel: {formatter: v => nf0.format(v / 1000)}}),
      R.ax({type: 'value', min: 0, max: 100, splitLine: {show: false}, axisLabel: {formatter: v => v + '%'}})],
    tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: ps => { const i = ps[0].dataIndex;
      return R.tip(`${anos[i]}${anos[i] === 2021 || anos[i] === 2022 ? ' (vintage 2021 incompleta: extinções de 2022 caem em 2021)' : ''}`, zs.map(z => [Z_LB[z], `${nf0.format(m2[z][i] / 1000)} mil m² · ${n[z][i]} eventos`, zc[z]]).concat([
        ['Unificados neste ano (S2)', `${nf0.format(bn[i])} · ${nf0.format(b[i] / 1000)} mil m²`], ['… já lançados ou individualizados', conv[i] != null ? `${nf0.format(conv[i])}% da área (${cn[i]})` : 'n < 10']]),
      `ano em que os lotes de origem saem do IPTU (vintage anual, ± 12 m) · lançado = ${LIC_ON ? FONTE + ', ' : ''}1ª guia de planta ou condomínio`); }}),
    series: zs.map(z => ({name: Z_LB[z], type: 'bar', stack: 'a', data: m2[z], itemStyle: {color: zc[z]}, barCategoryGap: '25%',
      markArea: z === zs[0] ? {silent: true, itemStyle: {color: css('--hatch'), opacity: 0.35}, data: [[{xAxis: '2021'}, {xAxis: '2022'}]]} : undefined}))
      .concat([{name: '% lançado', type: 'line', yAxisIndex: 1, data: conv, symbol: 'circle', symbolSize: 5, connectNulls: false, lineStyle: {color: css('--ink'), width: 1.8}, itemStyle: {color: css('--ink')}, z: 5}]),
  }), true);
  $('trFlowSub').textContent = `Área dos lotes de origem por ano em que saem do cadastro (IPTU, ± 12 m; o trimestre não existe nessa fonte), por grupo de zona. Linha: das coortes que aparecem como lote unificado (S2), % da área que já foi lançada ou virou condomínio${TD.por || !LIC_ON ? '' : ` (sem ${FONTE}: só planta ITBI e IPTU)`}. Coortes recentes ainda estão em curso.`;
  $('trFlowLeg').innerHTML = zs.map(z => `<span class="it"><i class="dot" style="border-radius:2px;background:${zc[z]}"></i>${esc(Z_LB[z])}</span>`).join('') + `<span class="it"><i class="lk" style="background:var(--ink)"></i>% da área unificada já lançada</span><span class="it muted">▨ 2021–22: vintage 2021 incompleta (A3)</span>`;
}
/* compras em quadras com sinal (A+…C), por trimestre (ITBI: data exata) */
function renderFlowQ() {
  const c = R.chart('trFlowQ'); if (!c) return;
  const T = TD.flu.trim, zs = ZF[P.tz] || ZK, zc = zoneColors();
  const lab = T.q.map(q => T.parcial[q] ? q + '*' : q);
  c.setOption(Object.assign(R.base(), {
    grid: {left: 54, right: 16, top: 18, bottom: 30},
    xAxis: R.ax({type: 'category', data: lab, axisLabel: {fontSize: 10}}),
    yAxis: R.ax({type: 'value', name: 'mil m² comprados', nameGap: 8, nameTextStyle: {align: 'left'}, axisLabel: {formatter: v => nf0.format(v / 1000)}}),
    tooltip: Object.assign(R.base().tooltip, {trigger: 'axis', formatter: ps => { const i = ps[0].dataIndex;
      return R.tip(`${T.q[i]}${T.parcial[T.q[i]] ? ' (parcial: ' + T.parcial[T.q[i]] + ')' : ''}`, zs.map(z => [Z_LB[z], `${nf0.format(T.m2[z][i] / 1000)} mil m² · ${nf0.format(T.n[z][i])} lotes`, zc[z]]).concat([['… dos quais em quadras A+', `${nf0.format(T.m2_Ap[i] / 1000)} mil m² (lotes A+)`]]),
        'compra integral (≥ 50%) de lote ativo em 2026, em quadra com ≥ 2 lotes comprados ou vizinho na mesma rua · data da última compra'); }}),
    series: zs.map(z => ({name: Z_LB[z], type: 'bar', stack: 'a', data: T.m2[z].map((v, i) => ({value: v, itemStyle: {color: zc[z], opacity: T.parcial[T.q[i]] ? 0.45 : 1}})), barCategoryGap: '25%'}))
      .concat(P.tz === 'todas' ? [{name: 'A+', type: 'line', data: T.m2_Ap, symbol: 'circle', symbolSize: 5, lineStyle: {color: css('--ink'), width: 1.8}, itemStyle: {color: css('--ink')}, z: 5}] : []),
  }), true);
  $('trFlowQSub').textContent = 'Terreno de lotes comprados (compra integral) em quadras com sinal A+, A, B ou C, pelo trimestre da compra. É o fluxo em curso: ainda não virou unificação no IPTU. Sem filtro de mínimo de lotes (cada quadra já tem ≥ 2).';
  $('trFlowQLeg').innerHTML = zs.map(z => `<span class="it"><i class="dot" style="border-radius:2px;background:${zc[z]}"></i>${esc(Z_LB[z])}</span>`).join('') + (P.tz === 'todas' ? `<span class="it"><i class="lk" style="background:var(--ink)"></i>lotes A+</span>` : '') + `<span class="it muted">* trimestre parcial (3T2024: ago–set; 3T2026: só jul)</span>`;
}

/* padrões: 5 tipos (A3 §4) em gráficos pequenos de formas, na mesma escala */
function renderPad() {
  const T = TD.pad.tipos, BOX = 60;
  const shape = f => { const pts = f.r, path = 'M' + pts.map(p => `${(p[0] / BOX * 44 + 50).toFixed(1)} ${(50 - p[1] / BOX * 44).toFixed(1)}`).join('L') + 'Z';
    return `<svg viewBox="0 0 100 100" class="trform" role="img" aria-label="terreno de ${f.a} m², ${f.nl} lotes"><title>${esc(f.id)} · ${nf0.format(f.a)} m² · ${f.nl} lotes</title><path d="${path}"/></svg>`; };
  const base = TD.ev.filter(e => e.k != null && e.nl >= P.tl && (!ZF[P.tz] || ZF[P.tz].includes(e.z)));
  $('trPad').innerHTML = T.map(t => {
    const g = base.filter(e => e.k === t.k), pr = g.filter(e => e.rs != null);
    const rs = q3(pr.map(e => e.rs)), pm = q3(pr.map(e => e.pm)), ar = q3(g.map(e => e.a)), un = med(g.map(e => e.un));
    const lanc = g.length ? g.filter(e => e.st >= 4).length / g.length * 100 : null;
    const ml = TD.por ? med(g.flatMap(e => e.refs.map(r => TD.por.refs[r].mcl)).filter(v => v != null)) : null;
    const mln = TD.por ? g.flatMap(e => e.refs.map(r => TD.por.refs[r].mcl)).filter(v => v != null).length : 0;
    const tv = TD.por ? q3(g.flatMap(e => e.refs.map(r => TD.por.refs[r].tv)).filter(v => v != null)) : null;
    return `<div class="trpc${t.excl ? ' excl' : ''}"><h4>${esc(t.nome)}</h4><p class="d">${esc(t.desc)}</p><div class="trforms">${t.formas.map(shape).join('')}</div>
      <dl><dt>Eventos nos filtros</dt><dd title="${nf0.format(t.n)} no tipo, sem filtro">${nf0.format(g.length)}</dd>
      <dt>Terreno mediano</dt><dd title="${ar ? `IQR ${nf0.format(ar[0])}–${nf0.format(ar[2])} m²` : ''}">${ar ? fM2(ar[1]) : '—'}</dd>
      <dt>R$/m² de terreno</dt><dd title="${rs ? `IQR ${nf0.format(rs[0])}–${nf0.format(rs[2])} · n=${rs[3]} · R$ jul/26` : 'sem preço medido'}">${rs ? nf0.format(rs[1]) : '—'}${rs ? `<small> n=${rs[3]}</small>` : ''}</dd>
      <dt>Prêmio s/ mercado</dt><dd title="${pm ? `IQR ${nf2.format(pm[0])}–${nf2.format(pm[2])} · n=${pm[3]}` : ''}">${pm ? fX(pm[1]) : '—'}</dd>
      <dt>Unidades</dt><dd>${un != null ? nf0.format(un) : '—'}</dd>
      <dt>Já lançado</dt><dd title="${LIC_ON ? esc(FONTE) + ', ' : ''}1ª guia de planta ou condomínio no IPTU">${lanc != null ? nf0.format(lanc) + '%' : '—'}</dd>
      ${LIC_ON ? `<dt>Compra → lanç. <span class="lic">${esc(FONTE)}</span></dt><dd title="${mln ? 'n=' + mln : ''}">${ml != null ? fI(ml) + ' m' : '—'}</dd>
      <dt>Terreno ÷ VGV <span class="lic">${esc(FONTE)}</span></dt><dd title="${tv ? `IQR ${nf0.format(tv[0])}–${nf0.format(tv[2])}% · n=${tv[3]}` : ''}">${tv ? nf1.format(tv[1]) + '%' : '—'}</dd>` : ''}
      <dt>Compra → unidades</dt><dd title="IPTU · n=${t.m_compra_unid[1]} (todos do tipo)">${t.m_compra_unid[0] != null ? fI(t.m_compra_unid[0]) + ' m' : '—'}</dd></dl>
      <p class="pf">${t.casa}% casas · ${t.vago}% vago · ${t.galpao}% galpão · ${t.eixo}% em eixo · estação a ${nf0.format(t.de)} m (todos do tipo)</p></div>`;
  }).join('');
  $('trPadSub').innerHTML = `Os 5 tipos do A3 (k-means sobre 13.814 eventos verticais e lotes unificados; leitura por regra: casas × vago × galpão, eixo, distância ao metrô, área). Formas: terrenos típicos de cada tipo, todos no mesmo quadro de ${BOX * 2} × ${BOX * 2} m. Números com os filtros do topo (zona, ≥ ${P.tl} lote${P.tl > 1 ? 's' : ''}); passe o mouse para ver IQR e n. O tipo "prédio existente individualizado" sai das estatísticas de montagem e do mapa. ${LIC_ON ? `Compra → lançamento vem da ${esc(FONTE)} ${LIC}; os demais números são ITBI/IPTU.` : 'Números do ITBI e do IPTU.'} ${esc(PERMUTA)}`;
  const perf = (id, rows, lab) => { const c = R.chart(id); if (!c) return;
    c.setOption(Object.assign(R.base(), {grid: {left: lab, right: 30, top: 6, bottom: 20},
      xAxis: R.ax({type: 'value', axisLabel: {formatter: v => v + '%'}}), yAxis: R.ax({type: 'category', data: rows.map(r => r[0]), inverse: true, splitLine: {show: false}, axisLabel: {fontSize: 10, color: css('--ink-2')}}),
      tooltip: Object.assign(R.base().tooltip, {trigger: 'item', formatter: p => { const r = rows[p.dataIndex]; return R.tip(r[0], [['Taxa (11 anos)', nf2.format(r[1]) + '%'], ['Lotes em 2015', nf0.format(r[2])], ['Viraram origem de incorporação', nf0.format(r[3])]], 'lotes não-condomínio do IPTU 2015 que viraram origem de evento em 2016–2026 (base 1,7%)'); }}),
      series: [{type: 'bar', data: rows.map(r => r[1]), itemStyle: {color: css('--s1')}, barCategoryGap: '30%', label: {show: true, position: 'right', fontSize: 10, color: css('--ink-2'), formatter: p => nf1.format(p.value) + '%'}}]}), true); };
  perf('trPerfD', TD.pad.perfil.dist_estacao_m.map(r => [r[0] + ' m', r[1], r[2], r[3]]), 80);
  perf('trPerfZ', TD.pad.perfil.zona_grupo.filter(r => r[2] > 5000).sort((a, b) => b[1] - a[1]), 190);
}
function renderCov() {
  const M = TD.meta, u = M.universo;
  $('trCov').innerHTML = `<div class="two"><div><table class="t"><thead><tr><th>Lotes de origem extintos em</th><th class="n">Lotes</th><th class="n">% com compra no ITBI (8 anos antes)</th><th class="n">Linha de base (sobreviventes)</th></tr></thead><tbody>${
    M.obs.map(r => `<tr${r[0] < 2023 ? ' class="trgray"' : ''}><td>${r[0]}</td><td class="n">${nf0.format(r[1])}</td><td class="n">${nf1.format(r[2])}%</td><td class="n">${nf1.format(r[3])}%</td></tr>`).join('')}</tbody></table>
    <p class="note">A guia só sobrevive no arquivo publicado se o SQL ainda existia quando a Prefeitura gerou o arquivo (2006–18 em 10/2023; 2019–21 em 09/2022; 2022 em 01/2023; 2023 em 01/2024; 2025 em 01/2026). Por isso o preço do terreno só existe para lotes extintos a partir de 2023; antes disso: <b>sem registro no ITBI (limite da fonte)</b>, nunca zero.</p></div>
    <div><ul class="trnotes">
      <li><b>Universo:</b> ${nf0.format(u.eventos)} eventos verticais e lotes unificados (IPTU 2011–2026); casas em condomínio ficam fora; ${nf0.format(u.tipo3)} "prédio existente individualizado" (tipo 3) ficam fora do mapa e das estatísticas. Com preço medido: ${nf0.format(u.com_preco)} (${nf0.format(u.com_preco_2lotes)} com ≥ 2 lotes).</li>
      <li><b>Datas do IPTU:</b> vintage anual (± 12 meses); o condomínio aparece 1–2 exercícios depois do início de vida das unidades; 84% dos condomínios cancelam os lotes de origem no mesmo exercício (sem S2 visível).</li>
      <li><b>Permutas</b> (natureza ≠ compra e venda) e compras há mais de 8 anos não entram: ${esc(PERMUTA.toLowerCase())}</li>
      <li><b>Prêmio</b> = valor/VVR ÷ mediana das compras integrais de lotes no mesmo distrito e ano (nunca valor/VVR puro, que tem os degraus da PGV).</li>
      <li><b>Sinal A+</b> é triagem: acerta ${esc(btTxt())} das incorporações em 2–4 anos; B e C (≤ 7%) só como densidade. O ITBI não tem nomes: não dá para afirmar que o mesmo comprador levou os lotes.</li>
      <li><b>${esc(ZONA_NOTA)}</b></li>
      ${LIC_ON ? `<li><b>${esc(FONTE)}</b> (licenciada, uso interno): ligação A3 por ponto ≤ 60 m ou endereço + razão de área [0,6; 1,6]; VGV = tabela atual × unidades (proxy). ${TD.por ? nf0.format(TD.por.agg.n_refs) + ' Referências ligadas a ' + nf0.format(TD.por.agg.n_eventos) + ' eventos.' : 'Indisponível nesta sessão.'}</li>` : ''}
      <li><b>Fontes:</b> ${esc(M.fontes.join(' · '))}. Valores em R$ nominais e de jul/2026 (IPCA).</li></ul></div></div>`;
}

/* ── seção na vista Lançamento (do módulo licenciado; sem ele a vista não existe): o terreno da Referência ── */
if (LIC_ON) R.registerSection('lancamento', {id: 'terreno', title: 'Terreno', sub: `Lotes que formaram o terreno (IPTU), compras no ITBI e peso no VGV · ${FONTE} uso interno`, order: 80,
  render(el, ctx, card) {   // sem evento de unificação e sem compra dos lotes antigos: a seção some
    const ref = ctx && ctx.ref != null ? String(ctx.ref) : null; if (!ref) return false;
    el.innerHTML = '<div class="loading">Carregando o terreno…</div>';
    loadPor().then(p => {
      if (!p) { el.innerHTML = `<p class="sub">${esc(FONTE)} indisponível: terrenos/${esc(R.licenciado.por_ref)} não carregou (abra pelo serve.py).</p>`; return; }
      const r = p.refs[ref];
      if (!r) return R.loadJSON(DIR + R.licenciado.por_ref_elo).then(x => { if (!(x && x.a1[ref] && x.a1[ref].length)) { if (card) card.hidden = true; return; } el.innerHTML = semTerreno(ref, x); }).catch(() => { if (card) card.hidden = true; });
      const e = TD.byId[r.ev]; if (!e) { el.innerHTML = semTerreno(ref, null); return; }
      return loadGeo(e.cd).then(() => { el.innerHTML = lancTerreno(ref, r, e); lancLots(el, ref, e); wireCard(el); });
    }).catch(err => { el.innerHTML = `<p class="sub">Terreno indisponível (${esc(err.message || err)}).</p>`; });
  }});
function wireCard(el) {
  el.onclick = ev => { const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.lot) R.openLot(b.dataset.cd, b.dataset.lot); else if (b.dataset.ev) R.setView('terrenos', {tsel: b.dataset.ev}); };
}
function lancTerreno(ref, r, e) {
  const d = evDet(e) || {}, lm = mYM(r.lanc), casas = TD.meta.casas[e.cd];
  const ult = e.c2, mUlt = ult != null && lm != null ? lm - ult : r.mcl;
  const kp = [
    R.kpi('Terreno', fM2(r.tm2 || e.a), `${FONTE} ${fM2(r.tm2)} · IPTU ${fM2(e.a)} (${e.nl} lote${e.nl > 1 ? 's' : ''})`),
    R.kpi('Pago pelo terreno', e.vn != null ? fMoney(e.vn) : '—', e.vn != null ? `${fMoney(e.vr)} em R$ jul/26 · ${e.nc} de ${e.nl} lotes` : esc(priceTxt(e))),
    R.kpi('R$/m² de terreno', fRs(e.rs), e.rs != null && casas ? `casas do distrito ${nf0.format(casas[1])} (${nf2.format(e.rs / casas[1])}×)` : ''),
    R.kpi('Prêmio sobre o mercado', fX(e.pm), e.pm != null ? 'valor/VVR ÷ mediana do distrito' : ''),
    R.kpi('Terreno ÷ VGV', r.tv != null ? nf1.format(r.tv) + '%' : '—', r.tv != null ? `custo ${fMoney(r.custo)} · VGV ${fMoney(r.vgv)}${r.vcob != null ? ' (' + r.vcob + '% c/ preço)' : ''}` : 'sem custo medido ou sem VGV'),
    R.kpi('Última compra → lançamento', mUlt != null ? nf0.format(mUlt) + ' meses' : '—', `lançamento ${lm != null ? fMo(lm) : '—'} (${FONTE}) · mediana da cidade ${TD.por.agg.mcl[0]} m`),
  ].join('');
  const cps = d.cp || [];
  const comp = cps.length ? `<table class="t"><thead><tr><th>Data</th><th>SQL</th><th class="n">Valor</th><th class="n">R$ jul/26</th><th class="n">Prop.</th><th>Natureza</th><th class="n">Meses até o lanç.</th></tr></thead><tbody>${
    cps.map(c => `<tr><td>${fDay(c[0])}</td><td>${sqlLb(c[1])}</td><td class="n">${fMoney(c[2])}</td><td class="n">${fMoney(c[3])}</td><td class="n">${c[4] != null ? nf0.format(c[4]) + '%' : '—'}</td><td>${esc(NAT[c[5]] || c[5])}</td><td class="n">${lm != null ? nf0.format(lm - mYMD(c[0])) : '—'}</td></tr>`).join('')}</tbody></table>` : `<p class="note"><b>Sem compras:</b> ${esc(priceTxt(e))}.</p>`;
  return `<div class="trsel-h"><div><span class="eyebrow">${esc(TP_LB[e.tp])} · ${esc(ST_LB[e.st])}</span> ${LIC}<h3>${esc(d.end || 'Quadra ' + sqLb(e.id.slice(1, 7)))}</h3>
      <span class="meta">evento ${esc(e.id)} · ligação ${esc(r.met === 'ponto' ? 'por ponto (≤ 60 m do polígono)' : 'por endereço')} · terreno ${esc(FONTE)} ÷ IPTU ${r.ra != null ? nf2.format(r.ra) : '—'}</span></div>
    <div class="trsel-b">${d.lid && e.tp !== 'N' ? `<button type="button" class="linkbtn" data-cd="${esc(e.cd)}" data-lot="${esc(d.lid)}">Prédio / lote →</button>` : ''}${R.viewOn && !R.viewOn('terrenos') ? '' : `<button type="button" class="linkbtn" data-ev="${esc(e.id)}">no radar de terrenos →</button>`}</div></div>
    ${timeline(e, d)}<div class="kpis trkp">${kp}</div>
    <div class="trsel-g"><div>${miniSvg(d)}<p class="note">Cheio: lote/condomínio de 2026${(d.o || []).length ? ' · tracejado: lotes antigos' : ' · os lotes antigos não têm polígono (não há camada histórica)'}.</p></div>
    <div><h4 class="trh4">Compras dos lotes (ITBI)</h4><div class="tablewrap">${comp}</div>${d.es ? `<p class="note">Estimado para o terreno inteiro: <b>${fMoney(d.es)}</b> (R$ jul/26).</p>` : ''}<p class="note">${esc(PERMUTA)} VGV = tabela atual × unidades (proxy do VGV de lançamento).</p>
    <h4 class="trh4">Lotes que formaram o terreno</h4><div class="tablewrap trlots"></div></div></div>`;
}
/* lotes de origem do terreno: tabela paginada ("mostrar mais"), sem rolagem interna */
function lancLots(el, ref, e) {
  const box = el.querySelector('.trlots'), d = evDet(e) || {}; if (!box) return;
  R.table(box, 'trLots', [
    {k: 'sql', label: 'SQL', sv: f => f[0], f: f => sqlLb(f[0])}, {k: 'end', label: 'Endereço', cls: 'wrap', sv: f => f[2], f: f => esc(f[2] || '—')},
    {k: 'm2', label: 'Terreno', n: 1, sv: f => f[1], f: f => fM2(f[1])}, {k: 'uso', label: 'Uso', sv: f => f[3], f: f => esc(f[3] || '—')},
    {k: 'sai', label: 'Sai do IPTU', n: 1, sv: f => f[5], f: f => f[5] || '—'},
  ], d.f || [], {page: 6, pageKey: ref});
}
function semTerreno(ref, x) {
  const elo = x && x.elo[ref], a1 = x && x.a1[ref] || [];
  const conf = elo ? {A: 'certo (cadastral)', B: 'provável', C: 'ambíguo', D: 'sem candidato no cadastro'}[elo[0]] || '—' : null;
  const why = [];
  if (!elo) why.push('a Referência não está no universo ligado ao cadastro (A1)');
  else {
    if (elo[0] === 'D') why.push(`nenhum lote do cadastro casou com o endereço ou o ponto da ${FONTE} (endereço antigo, esquina ou número que mudou)`);
    if (elo[3] === 0) why.push('a pegada no cadastro está incompleta: em obra, o terreno em geral ainda não foi unificado no IPTU');
    if (!elo[2]) why.push('nenhum SQL antigo do terreno sumiu do cadastro entre 2010 e 2026 (lançamento anterior à janela do IPTU ou terreno de lote único)');
    else if (elo[2] === 1) why.push('o terreno é um lote único (1 SQL antigo): não houve unificação de lotes');
  }
  why.push('o A3 só liga eventos verticais detectados por balanço de área [0,80; 1,25] na mesma quadra');
  return `<p class="sub">${LIC} Sem evento de unificação ligado a esta Referência. Elo com o cadastro (A1): <b>${esc(conf || '—')}</b>${elo && elo[1] ? ` · lote principal ${esc(elo[1])}` : ''}.</p>
    <ul class="trnotes">${why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` +
    (a1.length ? `<h4 class="trh4">Compras nos SQLs antigos do terreno (elo A1, natureza compra e venda integral)</h4><table class="t"><thead><tr><th>Data</th><th>SQL</th><th class="n">Valor</th><th class="n">R$ jul/26</th><th class="n">Prop.</th></tr></thead><tbody>${
      a1.map(g => `<tr><td>${fDay(g[0])}</td><td>${sqlLb(g[1])}</td><td class="n">${fMoney(g[2])}</td><td class="n">${fMoney(g[3])}</td><td class="n">${g[4] != null ? nf0.format(g[4]) + '%' : '—'}</td></tr>`).join('')}</tbody></table>
      <p class="note">Sem o evento, a área do terreno não é conhecida no cadastro: sem R$/m². ${esc(PERMUTA)}</p>` : `<p class="note">Sem guia de compra nos SQLs antigos do terreno: ${esc(F6)}.</p>`);
}

/* ── seção no Prédio: origem do terreno quando o lote é um condomínio (ou lote) vindo de unificação ── */
R.registerSection('predio', {id: 'origem-terreno', title: 'Origem do terreno', sub: 'Unificação de lotes no IPTU e compra no ITBI (radar de terrenos)', order: 60,
  render(el, ctx, card) {
    const lot = ctx && ctx.lot; if (!lot || !ctx.cd) return false;
    if (TD.ev && TD.geo[ctx.cd] && !TD.lid[lot.id]) return false;     // já sabemos: não veio de unificação
    el.innerHTML = '<div class="loading">Procurando a origem do terreno…</div>';
    loadCore().then(() => loadGeo(ctx.cd)).then(() => {
      if (R.S.view !== 'predio' || !R.S.lot || R.S.lot !== lot.id) return;
      const id = TD.lid[lot.id], e = id && TD.byId[id];
      if (!e) { card.hidden = true; return; }
      card.hidden = false;
      const d = evDet(e);
      if (e.k === 3) { el.innerHTML = `<p class="sub">Condomínio fiscal criado no IPTU ${e.tu} sobre um lote já construído (densidade ≈ 3): individualização de prédio existente, não incorporação nova (A3, P-A3-8).</p>`; return; }
      const uni = e.nl >= 2 ? `Terreno formado por <b>${e.nl} lotes</b> (${fM2(e.a)})` : `Condomínio sobre <b>1 lote</b> (${fM2(e.a)}), sem unificação`;
      el.innerHTML = `<p>${uni}${e.s2 ? ` · lote unificado no IPTU ${e.s2} (± 12 m)` : ''}${e.st0 === 5 ? ` · condomínio no IPTU ${e.tu}${e.du != null ? ' (unidades desde ' + fMo(e.du) + ')' : ''}` : ''}.</p>
        <div class="kpis trkp">${[R.kpi('Pago pelo terreno', e.vn != null ? fMoney(e.vn) : '—', e.vn != null ? `${fMoney(e.vr)} em R$ jul/26` : esc(priceTxt(e))),
          R.kpi('R$/m² de terreno', fRs(e.rs), e.rs != null ? `${e.nc} de ${e.nl} lotes com compra` : ''), R.kpi('Prêmio', fX(e.pm), e.pm != null ? 'valor/VVR ÷ distrito' : ''),
          R.kpi('Compras', e.c2 != null ? (d && d.c1 && mYM(d.c1) !== e.c2 ? fMo(mYM(d.c1)) + ' → ' : '') + fMo(e.c2) : '—', e.k != null ? 'tipo: ' + K_LB[e.k] : '')].join('')}</div>
        <p class="note">${esc(PERMUTA)}${R.viewOn && !R.viewOn('terrenos') ? '' : ` <button type="button" class="linkbtn" data-ev="${esc(e.id)}">ver no radar de terrenos →</button>`}</p>`;
      wireCard(el);
    }).catch(() => { card.hidden = true; });
  }});
