/* ════════ Contexto urbano (m_contexto) · trilhos, zoneamento, equipamentos, regiões comerciais, densidades, riscos ════════
   Dados: contexto/*.json (build_contexto.py, a partir das camadas do A4). Coordenada só nativa da fonte (GeoSampa, CNES,
   OSM, SSP) ou o ponto interior do lote fiscal; nenhum geocodificador.
   Regras (A6 §1.4/H17 + decisões do orquestrador): categorias em forma/traço/hachura de tinta, nunca matiz novo; densidades
   são "fill" (uma escala contínua por mapa); ícones só no zoom ≥ 16 e, por padrão, só o subconjunto decisivo; favela nunca
   aparece; OSM sempre com a ressalva de cobertura; sem nota composta de caminhabilidade. */
const {esc, nf0, nf1, css} = R;
const DATA = 'contexto/';
/* carga com no máx. 2 pedidos simultâneos e 2 novas tentativas: o serve.py (http.server, fila de conexões = 5) reseta
   conexões quando a página do Prédio dispara muitos pedidos de uma vez */
const QMAX = 2, QW = [], JC = {}; let qN = 0;
function qrun() { while (qN < QMAX && QW.length) { const t = QW.shift(); qN++; t().then(() => { qN--; qrun(); }, () => { qN--; qrun(); }); } }
function get(p) {
  if (JC[p]) return JC[p];
  const once = () => new Promise((res, rej) => { QW.push(() => R.loadJSON(DATA + p).then(res, e => { rej(e); throw e; })); qrun(); });
  const tryN = n => once().catch(e => n > 0 ? new Promise(r => setTimeout(r, 350 * (3 - n))).then(() => tryN(n - 1)) : Promise.reject(e));
  return (JC[p] = tryN(2).catch(e => { delete JC[p]; throw e; }));
}
const C = {meta: null, tr: null, trFC: null, trL: null, zonE: null, zon: {}, poi: {}, poiFC: {}, inund: {}, lote: {}, parques: null, com: null, riscos: null, dens: {},
  mode: null, wasOn: {}, sets: {}, err: {}};
const LAT0 = -23.6, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
const toM = p => [(p[0] + 46.6) * KX, (p[1] - LAT0) * KY];
const dm = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);   // metros, plano local (erro < 0,5% no município)
const fm = d => d == null || !isFinite(d) ? '—' : d < 1000 ? nf0.format(Math.round(d / 10) * 10) + ' m' : nf1.format(d / 1000) + ' km';
const DATE_GS = '27/09/2026';
/* camadas fora do menu por pedido do usuário (28/09/2026): o código segue aqui; para religar, tire o id do conjunto */
const LAYER_OFF = new Set(['comercial', 'varejo', 'riscos']);
const regLayer = l => { if (!LAYER_OFF.has(l.id)) R.registerLayer(l); };

/* ── sub-camadas de equipamentos (espelha SUBS do build) · as 7 primeiras = subconjunto decisivo (A4 §7) ── */
const SUBS = [
  ['escola', 'Escolas (IDEB 2023)', 'E'], ['saude', 'UBS, AMA e hospitais', 'H'], ['abast', 'Supermercado e feira', 'S'],
  ['parque', 'Parques e praças', 'P'], ['seg', 'Delegacia, PM, GCM, bombeiros', 'D'], ['pub', 'Prédios públicos', 'Pb'],
  ['cemit', 'Cemitérios (tom neutro)', '†'], ['infantil', 'Creches', 'C'], ['univ', 'Universidades e faculdades', 'U'],
  ['alim', 'Restaurantes, bares, cafés', 'R'], ['comercio', 'Shopping e farmácia', 'Sh'], ['esporte', 'Academias e clubes', 'A'],
  ['cult', 'Cultura', 'Cu'], ['templo', 'Templos e igrejas', 'T'],
];
const DECISIVO = SUBS.slice(0, 7).map(s => s[0]);
const OSM_SUB = new Set(['alim', 'templo']);   // sub-camadas só do OSM
const LK = {ex: '', ob: '4 3', pl: '0.1 3.6'};
const BUS_COR = '#8C2F24';   // corredor de ônibus: vermelho escuro fixo (cor de dado; a mesma nos dois temas)
/* traço de legenda: k = ex (cheio) | ob (tracejado) | pl (pontilhado) | bus | polo; `cor` opcional (ex.: cor oficial da linha) */
const lkSvg = (k, w = 22, cor) => { const c = cor || (k === 'pl' ? 'var(--ink-2)' : k === 'bus' ? BUS_COR : 'var(--ink)');
  return `<svg class="ctx-lks" width="${w}" height="8" viewBox="0 0 ${w} 8" aria-hidden="true"><line x1="1.5" y1="4" x2="${w - 1.5}" y2="4" stroke="${c}" stroke-width="${k === 'bus' ? 2 : k === 'polo' ? 1.8 : 2.6}" stroke-linecap="${k === 'pl' ? 'round' : 'butt'}"${k === 'ob' ? ' stroke-dasharray="4 3"' : k === 'pl' ? ' stroke-dasharray="0.1 4"' : k === 'polo' ? ' stroke-dasharray="5 3"' : ''}/></svg>`; };
const glyph = (g, sq, neutral) => `<span class="ctx-gl${sq ? ' sq' : ''}${neutral ? ' neu' : ''}" aria-hidden="true">${esc(g)}</span>`;
/* ícones minimalistas (Tabler Icons, MIT — tabler.io/icons): traço de 24 px, só <path>; desenhados no canvas com Path2D.
   Categoria → ícone: mochila = escola, carrinho = creche, capelo = faculdade, estetoscópio = UBS/AMA, prédio com cruz = hospital,
   pílula = farmácia, carrinho de compras = supermercado, cenoura = feira, garfo e faca = restaurante, sacola = shopping,
   haltere = academia, árvores = parque, árvore = praça, bola = clube, máscaras = cultura, escudo = delegacia, sirene = PM/GCM/
   bombeiros, colunas = prédio público, igreja = templo, lápide = cemitério, trem = estação, ônibus = terminal. */
const ICO = {"esc_pub":"M5 18v-6a6 6 0 0 1 6 -6h2a6 6 0 0 1 6 6v6a3 3 0 0 1 -3 3h-8a3 3 0 0 1 -3 -3z M10 6v-1a2 2 0 1 1 4 0v1 M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4 M11 10h2","esc_priv":"M5 18v-6a6 6 0 0 1 6 -6h2a6 6 0 0 1 6 6v6a3 3 0 0 1 -3 3h-8a3 3 0 0 1 -3 -3z M10 6v-1a2 2 0 1 1 4 0v1 M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4 M11 10h2","infantil":"M8 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M18 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M2 5h2.5l1.632 4.897a6 6 0 0 0 5.693 4.103h2.675a5.5 5.5 0 0 0 0 -11h-.5v6 M6 9h14 M9 17l1 -3 M16 14l1 3","univ":"M22 9l-10 -4l-10 4l10 4l10 -4v6 M6 10.6v5.4a6 3 0 0 0 12 0v-5.4","ubs":"M6 4h-1a2 2 0 0 0 -2 2v3.5h0a5.5 5.5 0 0 0 11 0v-3.5a2 2 0 0 0 -2 -2h-1 M8 15a6 6 0 1 0 12 0v-3 M11 3v2 M6 3v2 M20 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","hosp":"M3 21l18 0 M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16 M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4 M10 9l4 0 M12 7l0 4","farm":"M4.5 12.5l8 -8a4.94 4.94 0 0 1 7 7l-8 8a4.94 4.94 0 0 1 -7 -7 M8.5 8.5l7 7","super":"M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M17 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M17 17h-11v-14h-2 M6 5l14 1l-1 7h-13","feira":"M3 21s9.834 -3.489 12.684 -6.34a4.487 4.487 0 0 0 0 -6.344a4.483 4.483 0 0 0 -6.342 0c-2.86 2.861 -6.347 12.689 -6.347 12.689z M9 13l-1.5 -1.5 M16 14l-2 -2 M22 8s-1.14 -2 -3 -2c-1.406 0 -3 2 -3 2s1.14 2 3 2s3 -2 3 -2z M16 2s-2 1.14 -2 3s2 3 2 3s2 -1.577 2 -3c0 -1.86 -2 -3 -2 -3z","alim":"M19 3v12h-5c-.023 -3.681 .184 -7.406 5 -12zm0 12v6h-1v-3m-10 -14v17m-3 -17v3a3 3 0 1 0 6 0v-3","shop":"M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304z M9 11v-5a3 3 0 0 1 6 0v5","acad":"M2 12h1 M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2 M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z M9 12h6 M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2 M22 12h-1","parque":"M16 5l3 3l-2 1l4 4l-3 1l4 4h-9 M15 21l0 -3 M8 13l-2 -2 M8 12l2 -2 M8 21v-13 M5.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4z","praca":"M12 13l-2 -2 M12 12l2 -2 M12 21v-13 M9.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4z","esporte":"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7l4.76 3.45l-1.76 5.55h-6l-1.76 -5.55z M12 7v-4m3 13l2.5 3m-.74 -8.55l3.74 -1.45m-11.44 7.05l-2.56 2.95m.74 -8.55l-3.74 -1.45","cult":"M13.192 9h6.616a2 2 0 0 1 1.992 2.183l-.567 6.182a4 4 0 0 1 -3.983 3.635h-1.5a4 4 0 0 1 -3.983 -3.635l-.567 -6.182a2 2 0 0 1 1.992 -2.183z M15 13h.01 M18 13h.01 M15 16.5c1 .667 2 .667 3 0 M8.632 15.982a4.037 4.037 0 0 1 -.382 .018h-1.5a4 4 0 0 1 -3.983 -3.635l-.567 -6.182a2 2 0 0 1 1.992 -2.183h6.616a2 2 0 0 1 2 2 M6 8h.01 M9 8h.01 M6 12c.764 -.51 1.528 -.63 2.291 -.36","dp":"M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3","pol":"M8 16v-4a4 4 0 0 1 8 0v4 M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7 M6 16m0 1a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1z","pub":"M3 21l18 0 M3 10l18 0 M5 6l7 -3l7 3 M4 10l0 11 M20 10l0 11 M8 14l0 3 M12 14l0 3 M16 14l0 3","templo":"M3 21l18 0 M10 21v-4a2 2 0 0 1 4 0v4 M10 5l4 0 M12 3l0 5 M6 21v-7m-2 2l8 -8l8 8m-2 -2v7","cemit":"M7 16.17v-9.17a3 3 0 0 1 3 -3h4a3 3 0 0 1 3 3v9.171 M12 7v5 M10 9h4 M5 21v-2a3 3 0 0 1 3 -3h8a3 3 0 0 1 3 3v2h-14z","trem":"M21 13c0 -3.87 -3.37 -7 -10 -7h-8 M3 15h16a2 2 0 0 0 2 -2 M3 6v5h17.5 M3 11v4 M8 11v-5 M13 11v-4.5 M3 19h18","bus":"M6 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M18 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M4 17h-2v-11a1 1 0 0 1 1 -1h14a5 7 0 0 1 5 7v5h-2m-4 0h-8 M16 5l1.5 7l4.5 0 M2 10l15 0 M7 5l0 5 M12 5l0 5"};
const SUB_ICO = {escola: 'esc_pub', saude: 'hosp', abast: 'super', parque: 'parque', seg: 'dp', pub: 'pub', cemit: 'cemit', infantil: 'infantil', univ: 'univ',
  alim: 'alim', comercio: 'shop', esporte: 'acad', cult: 'cult', templo: 'templo'};
const icoSvg = k => ICO[k] ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICO[k]}"/></svg>` : '';
/* chip do ícone em HTML: círculo = fonte oficial (GeoSampa/CNES); quadrado = OSM; cinza = tom neutro */
const icoHtml = (k, sq, neutral) => `<span class="ctx-ic${sq ? ' sq' : ''}${neutral ? ' neu' : ''}" aria-hidden="true">${icoSvg(k)}</span>`;

/* ── geometria ───────────────────────────────────────────── */
function decRings(pe) {   // [[anel externo, buracos…], …] em inteiros delta a 1e-5 grau → coordenadas
  return pe.map(poly => poly.map(d => { const r = []; let x = 0, y = 0; for (let i = 0; i < d.length; i += 2) { x += d[i]; y += d[i + 1]; r.push([x / 1e5, y / 1e5]); } r.push(r[0]); return r; }));
}
const geomOf = pe => { const c = decRings(pe); return c.length === 1 ? {type: 'Polygon', coordinates: c[0]} : {type: 'MultiPolygon', coordinates: c}; };
function segD(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? R.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function distRingsM(P, polysM) {   // ponto métrico → distância até a borda de polígonos métricos (0 dentro)
  let best = Infinity;
  for (const poly of polysM) {
    let inside = false;
    poly.forEach((ring, ri) => {
      let inR = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > P[1]) !== (b[1] > P[1]) && P[0] < (b[0] - a[0]) * (P[1] - a[1]) / (b[1] - a[1]) + a[0]) inR = !inR;
        best = Math.min(best, segD(P, a, b));
      }
      if (ri === 0) inside = inR; else if (inR) inside = false;
    });
    if (inside) return 0;
  }
  return best;
}
function distLineM(P, coordsM) { let b = Infinity; for (let i = 1; i < coordsM.length; i++) b = Math.min(b, segD(P, coordsM[i - 1], coordsM[i])); return b; }
function pip(lng, lat, g) {   // ponto em Polygon/MultiPolygon (GeoJSON)
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.some(poly => { let ins = false; poly.forEach((ring, ri) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > lat) !== (b[1] > lat) && lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } if (ri === 0) ins = c; else if (c) ins = false; }); return ins; });
}
const distAt = (lng, lat) => { const f = R.DF.find(f => { const b = f.properties.bb; return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3] && pip(lng, lat, f.geometry); }); return f ? f.properties.cd : null; };
function bbHit(bbs, box) { return Object.keys(bbs).filter(cd => { const q = bbs[cd]; return !(q[2] < box[0] || q[0] > box[2] || q[3] < box[1] || q[1] > box[3]); }); }
const viewBox = map => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; };
const boxAround = (p, r) => { const dx = r / KX, dy = r / KY; return [p[0] - dx, p[1] - dy, p[0] + dx, p[1] + dy]; };

/* ── imagens do mapa: ícones (círculo = fonte oficial, quadrado = OSM) e hachuras (tinta) ── */
function iconImg(k, sq, neutral, solid) {   // solid: fundo em tinta e ícone claro (estações)
  const s = 44, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  const ink = neutral ? css('--muted') : css('--ink'), surf = css('--surface');
  x.beginPath();
  if (sq) { const m = 5, rr = 8, w = s - 2 * m; x.moveTo(m + rr, m); x.arcTo(m + w, m, m + w, m + w, rr); x.arcTo(m + w, m + w, m, m + w, rr); x.arcTo(m, m + w, m, m, rr); x.arcTo(m, m, m + w, m, rr); x.closePath(); }
  else x.arc(s / 2, s / 2, s / 2 - 4, 0, 2 * Math.PI);
  x.fillStyle = solid ? ink : surf; x.fill(); x.lineWidth = 2.4; x.strokeStyle = solid ? surf : ink; x.stroke();
  if (ICO[k]) {
    x.save(); const k0 = 1.05; x.translate(s / 2 - 12 * k0, s / 2 - 12 * k0); x.scale(k0, k0);
    x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = solid ? surf : ink; x.stroke(new Path2D(ICO[k])); x.restore();
  }
  return x.getImageData(0, 0, s, s);
}
function sqImg() {   // terminal de ônibus
  const s = 24, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  x.fillStyle = css('--surface'); x.fillRect(4, 4, 16, 16); x.lineWidth = 2.4; x.strokeStyle = css('--ink-2'); x.strokeRect(4, 4, 16, 16);
  return x.getImageData(0, 0, s, s);
}
const rgbaHex = (hex, a) => { if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex; const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function patImg(kind, color) {   // no escuro, tinta clara sobre fundo escuro "pesa" mais: alfa × 0,55
  const s = 24, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  const dk = R.mode() === 'dark' ? 0.55 : 1;
  const rgba = (h, a) => rgbaHex(h, a * dk);
  const ln = (a, b, e, f) => { x.beginPath(); x.moveTo(a, b); x.lineTo(e, f); x.stroke(); };
  x.lineCap = 'butt';
  const P = {
    eixo: () => { x.strokeStyle = rgba(color, 0.5); x.lineWidth = 1.6; for (let k = -s; k <= s; k += 8) ln(k, s, k + s, 0); },
    eixoP: () => { x.strokeStyle = rgba(color, 0.4); x.lineWidth = 1.3; for (let k = -s; k <= s; k += 12) ln(k, s, k + s, 0); },
    centr: () => { x.strokeStyle = rgba(color, 0.45); x.lineWidth = 1.4; for (let k = -s; k <= s; k += 12) { ln(k, s, k + s, 0); ln(k, 0, k + s, s); } },
    zer: () => { x.fillStyle = rgba(color, 0.6); [[6, 6], [18, 18]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 1.9, 0, 7); x.fill(); }); },
    zeis: () => { x.strokeStyle = rgba(color, 0.5); x.lineWidth = 1.7; ln(0, 6, s, 6); ln(0, 18, s, 18); },
    ind: () => { x.strokeStyle = rgba(color, 0.5); x.lineWidth = 1.7; ln(6, 0, 6, s); ln(18, 0, 18, s); },
    prot: () => { x.strokeStyle = rgba(color, 0.55); x.lineWidth = 1.4; [[6, 6], [18, 18]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 3.4, 0, 7); x.stroke(); }); },
    inund: () => { x.fillStyle = rgba(color, 0.7); for (let a = 3; a < s; a += 6) for (let b = 3; b < s; b += 6) { x.beginPath(); x.arc(a + ((b / 6) % 2) * 3, b, 1.2, 0, 7); x.fill(); } },
    geo: () => { x.strokeStyle = rgba(color, 0.6); x.lineWidth = 1.5; for (let k = -s; k <= s; k += 8) { ln(k, s, k + s, 0); ln(k, 0, k + s, s); } },
    hid: () => { x.strokeStyle = rgba(color, 0.6); x.lineWidth = 1.5; for (let k = -s; k <= s; k += 8) ln(k, 0, k + s, s); },
  };
  (P[kind] || (() => {}))();
  return x.getImageData(0, 0, s, s);
}
const G7 = ['eixo', 'centr', 'mista', 'zer', 'zeis', 'ind', 'prot', 'outros'];
const G7SW = {   // amostra da hachura na legenda (CSS)
  eixo: 'repeating-linear-gradient(135deg, var(--ctx-h) 0 1.4px, transparent 1.4px 5px)',
  centr: 'repeating-linear-gradient(45deg, var(--ctx-h2) 0 1px, transparent 1px 6px), repeating-linear-gradient(135deg, var(--ctx-h2) 0 1px, transparent 1px 6px)',
  mista: 'none', zer: 'radial-gradient(circle, var(--ctx-h) 1.2px, transparent 1.4px) 0 0/6px 6px',
  zeis: 'repeating-linear-gradient(0deg, var(--ctx-h2) 0 1.3px, transparent 1.3px 6px)', ind: 'repeating-linear-gradient(90deg, var(--ctx-h2) 0 1.3px, transparent 1.3px 6px)',
  prot: 'radial-gradient(circle, transparent 1.3px, var(--ctx-h2) 1.5px 2.2px, transparent 2.4px) 0 0/7px 7px', outros: 'none',
};
function putImages(map) {
  const m = R.mode(), fresh = map._ctxMode !== m; map._ctxMode = m;
  const need = id => fresh || !map.hasImage(id);
  const ink = css('--ink'), crit = css('--ctx-crit') || '#d03b3b';
  ['eixo', 'eixoP', 'centr', 'zer', 'zeis', 'ind', 'prot'].forEach(k => { if (need('ctx-pat-' + k)) R.putImage(map, 'ctx-pat-' + k, patImg(k, ink)); });
  ['inund', 'geo', 'hid'].forEach(k => { if (need('ctx-pat-' + k)) R.putImage(map, 'ctx-pat-' + k, patImg(k, crit)); });
  if (need('ctx-bus')) R.putImage(map, 'ctx-bus', sqImg());
  if (C.meta) C.meta.cats.forEach(c => ['c', 's'].forEach(sh => { const id = `ctx-i-${c.k}-${sh}`; if (need(id)) R.putImage(map, id, iconImg(c.k, sh === 's', c.k === 'cemit')); }));
  if (need('ctx-i-trem')) R.putImage(map, 'ctx-i-trem', iconImg('trem', false, false, true));
  if (need('ctx-i-trem-o')) R.putImage(map, 'ctx-i-trem-o', iconImg('trem', false, true, false));
}
function styleFont(map) {   // a fonte "regular" do próprio mapa base (evita itálico/negrito; glifos do mesmo servidor)
  const fonts = (map.getStyle().layers || []).filter(l => l.type === 'symbol' && l.layout && l.layout['text-font'])
    .map(l => { let f = l.layout['text-font']; if (Array.isArray(f) && f[0] === 'literal') f = f[1]; return Array.isArray(f) && f.every(x => typeof x === 'string') ? f : null; }).filter(Boolean);
  return fonts.find(f => /regular/i.test(f[0]) && !/italic/i.test(f[0])) || fonts.find(f => !/italic|bold/i.test(f[0])) || fonts[0] || ['Noto Sans Regular'];
}
const halo = () => ({'text-color': css('--ink'), 'text-halo-color': css('--surface'), 'text-halo-width': 1.6, 'text-halo-blur': 0.3});
function src(map, id, data, flags) { if (map.getSource(id)) return; map.addSource(id, {type: 'geojson', data: data || R.EMPTY_FC}); (flags || []).forEach(k => { delete C.sets[k]; }); }
const setSrc = (map, id, data) => { const s = map.getSource(id); if (s) s.setData(data); };

/* ── carga ───────────────────────────────────────────────── */
const meta = () => C.meta ? Promise.resolve(C.meta) : get('meta.json').then(m => { C.meta = m; return m; });
function lotePromise(cd) { return get(`lote/${cd}.json`).then(o => { if (!o._ix) { o._ix = new Map(o.id.map((id, i) => [id, i])); } return o; }); }
function poiDecode(cd, j) {
  if (C.poi[cd]) return C.poi[cd];
  const cats = C.meta.cats, arr = [];
  for (let i = 0; i < j.k.length; i++) arr.push({c: cats[j.k[i]], k: j.k[i], p: [j.x[i] / 1e5, j.y[i] / 1e5], n: j.n[i], a: j.a[i], b: j.b[i], s: j.s[i]});
  return (C.poi[cd] = arr);
}
function parquesM() {
  if (C.parques._m) return C.parques._m;
  return (C.parques._m = C.parques.p.map(p => ({p, bb: p.bb, m: decRings(p.g).map(poly => poly.map(r => r.map(toM)))})));
}
const SRC = ['GeoSampa', 'CNES', 'OSM'];
const srcLab = s => s === 0 ? `GeoSampa (CC BY-SA 4.0), ${DATE_GS}` : s === 1 ? 'CNES/DATASUS, 2026-08' : `OpenStreetMap (ODbL), ${DATE_GS} · cobertura desigual`;

/* ════════ camada: metrô e trem ═══════════════════════════ */
const TR_ST = {existente: 'existente', em_obra: 'em obra (lista manual P-A4-4, a validar com Metrô/STM)', planejada: 'planejada (GeoSampa "projetada"; sem previsão)'};
const lineLab = (l, n) => (n ? 'L' + n + ' ' : '') + (l || '');
/* Cores oficiais das linhas (Metrô, CPTM, ViaMobilidade, ViaQuatro): cor de dado, a mesma nos dois temas (no escuro só o contorno
   segue a superfície). Chave = nome da linha em caixa alta sem acento (propriedade `k` dos trechos; nas estações, derivada do nome).
   Linha sem cor oficial nos dados ('EXPRESSO AEROPORTO', 'ALPHAVILLE CAMPO LIMPO') cai na tinta secundária. */
const LINHA_COR = {AZUL: '#0455A1', VERDE: '#007E5E', VERMELHA: '#EE372F', AMARELA: '#F0C800', LILAS: '#7B2E88', LARANJA: '#F58220', RUBI: '#A3238E',
  DIAMANTE: '#97A098', ESMERALDA: '#01A9A7', TURQUESA: '#007E80', CORAL: '#F04E23', SAFIRA: '#083E8D', JADE: '#00B352', ONIX: '#3A3A3A', PRATA: '#9E9E9E',
  VIOLETA: '#6E3F97', OURO: '#E2B324', CELESTE: '#00A9E0', ROSA: '#E1A0C4', MARROM: '#8B5A2B'};
const LINHA_NOME = {LILAS: 'Lilás', ONIX: 'Ônix'};   // o rótulo leva acento; a chave, não
const linhaKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();   // 'Lilás' → 'LILAS'
const linhaNome = k => LINHA_NOME[k] || k.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());              // 'ALPHAVILLE CAMPO LIMPO' → 'Alphaville Campo Limpo'
const linhaCorExpr = () => ['match', ['get', 'k']].concat(Object.entries(LINHA_COR).flat(), [css('--ink-2')]);     // expressão MapLibre: cor por trecho/estação
R.linhaCor = k => LINHA_COR[linhaKey(k)] || css('--ink-2');   // para outros módulos: aceita a chave ('LILAS') ou o nome ('Lilás')
const ST_ORD = {existente: 0, em_obra: 1, planejada: 2};
function trLinhas() {   // linhas presentes nos dados carregados, por número: [{k, n, m, s (melhor status), lab, cor}]
  if (C.trL) return C.trL;
  const by = {};
  C.tr.ln.forEach(l => { const k = linhaKey(l.k || l.l), e = by[k] || (by[k] = {k, n: l.n, m: l.m, s: l.s}); if (ST_ORD[l.s] < ST_ORD[e.s]) e.s = l.s; if (e.n == null) e.n = l.n; });
  return (C.trL = Object.values(by).sort((a, b) => (a.n == null) - (b.n == null) || (a.n || 0) - (b.n || 0) || a.k.localeCompare(b.k))
    .map(e => Object.assign(e, {lab: lineLab(linhaNome(e.k), e.n) + (e.m === 'monotrilho' ? ' (monotrilho)' : ''), cor: LINHA_COR[e.k] || null})));
}
function trData() {
  if (C.trFC) return C.trFC;
  const t = C.tr, st = t.st.map((s, i) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [s[5], s[6]]}, properties: {i, nm: s[0], ln: lineLab(s[1], s[2]), k: linhaKey(s[1]), md: s[3], s: s[4],
    lab: s[4] === 'existente' ? s[0] : s[0] + (s[4] === 'em_obra' ? ' (em obra, a validar)' : ' (planejada)')}}));
  const ln = t.ln.map((l, i) => ({type: 'Feature', geometry: {type: 'LineString', coordinates: l.c}, properties: {i, l: l.l, k: linhaKey(l.k || l.l), n: l.n, m: l.m, s: l.s}}));
  const bus = t.tm.map((s, i) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [s[2], s[3]]}, properties: {i, nm: s[0], tp: s[1], k: 'term'}}))
    .concat(t.co.map((c, i) => ({type: 'Feature', geometry: {type: 'LineString', coordinates: c.c}, properties: {i, nm: c.n, st: c.s, k: 'corr'}})));
  return (C.trFC = {st: {type: 'FeatureCollection', features: st}, ln: {type: 'FeatureCollection', features: ln}, bus: {type: 'FeatureCollection', features: bus}});
}
const TRL = ['app-ctx-tr-case', 'app-ctx-tr-ex', 'app-ctx-tr-ob', 'app-ctx-tr-pl', 'app-ctx-bus-c', 'app-ctx-bus-t', 'app-ctx-tr-st', 'app-ctx-tr-lab'];
regLayer({
  id: 'trilhos', group: 'Contexto', order: 1, label: 'Metrô e trem',
  title: 'Linhas e estações de metrô, monotrilho e trem, cada linha na sua cor oficial. Cheia = existente; tracejada = em obra (lista manual, a validar); pontilhada = planejada (GeoSampa). Fonte: GeoSampa, 27/09/2026',
  subs: [{id: 'bus', html: `<i class="ctx-sq mini"></i> terminais e corredores de ônibus`, def: false}],
  add(H) {
    const map = H.map;
    const d = C.tr ? trData() : {};
    src(map, 'app-ctx-tr-ln', d.ln); src(map, 'app-ctx-tr-stsrc', d.st); src(map, 'app-ctx-bus', d.bus);
    R.addLayerOnce(map, {id: 'app-ctx-bus-c', type: 'line', source: 'app-ctx-bus', filter: ['==', ['get', 'k'], 'corr'], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2.4], 'line-opacity': 0.75, 'line-color': BUS_COR}});
    R.addLayerOnce(map, {id: 'app-ctx-tr-case', type: 'line', source: 'app-ctx-tr-ln', filter: ['==', ['get', 's'], 'existente'], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.6, 14, 6, 17, 8]}});
    R.addLayerOnce(map, {id: 'app-ctx-tr-pl', type: 'line', source: 'app-ctx-tr-ln', filter: ['==', ['get', 's'], 'planejada'], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 2.8, 17, 3.6], 'line-dasharray': [0.1, 2.2], 'line-color': linhaCorExpr()}});
    R.addLayerOnce(map, {id: 'app-ctx-tr-ob', type: 'line', source: 'app-ctx-tr-ln', filter: ['==', ['get', 's'], 'em_obra'], layout: {'line-join': 'round'}, paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 2.8, 17, 3.6], 'line-dasharray': [2.4, 1.6], 'line-color': linhaCorExpr()}});
    R.addLayerOnce(map, {id: 'app-ctx-tr-ex', type: 'line', source: 'app-ctx-tr-ln', filter: ['==', ['get', 's'], 'existente'], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 3.2, 17, 4.4], 'line-color': linhaCorExpr()}});
    R.addLayerOnce(map, {id: 'app-ctx-bus-t', type: 'symbol', source: 'app-ctx-bus', minzoom: 11, filter: ['==', ['get', 'k'], 'term'], layout: {'icon-image': 'ctx-bus', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 15, 1.2]}});
    R.addLayerOnce(map, {id: 'app-ctx-tr-st', type: 'circle', source: 'app-ctx-tr-stsrc', minzoom: 10.5,
      paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 10.5, ['case', ['==', ['get', 's'], 'existente'], 2.6, 2], 14, ['case', ['==', ['get', 's'], 'existente'], 5, 4], 17, ['case', ['==', ['get', 's'], 'existente'], 7, 5.5]],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10.5, 1.2, 14, 1.8], 'circle-stroke-color': linhaCorExpr()}});
    R.addLayerOnce(map, {id: 'app-ctx-tr-lab', type: 'symbol', source: 'app-ctx-tr-stsrc', minzoom: 13.5,
      filter: ['any', ['==', ['get', 's'], 'existente'], ['>=', ['zoom'], 14.5]],
      layout: {'text-field': ['get', 'lab'], 'text-font': styleFont(map), 'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 17, 12.5], 'text-anchor': 'top', 'text-offset': [0, 0.9],
        'text-max-width': 9, 'text-optional': true, 'symbol-sort-key': ['case', ['==', ['get', 's'], 'existente'], 0, 1]}});
  },
  update(H) {
    const map = H.map; putImages(map);
    const ink = css('--ink'), surf = css('--surface'), ink2 = css('--ink-2');
    const P = (id, k, v) => { if (map.getLayer(id)) map.setPaintProperty(id, k, v); };
    const lc = linhaCorExpr();   // cor oficial por linha (cor de dado: igual nos dois temas); só o contorno (case) e o miolo da estação seguem a superfície
    P('app-ctx-tr-case', 'line-color', surf); P('app-ctx-tr-case', 'line-opacity', 0.9);
    P('app-ctx-tr-ex', 'line-color', lc); P('app-ctx-tr-ob', 'line-color', lc); P('app-ctx-tr-pl', 'line-color', lc); P('app-ctx-bus-c', 'line-color', BUS_COR);
    P('app-ctx-tr-st', 'circle-color', surf);
    P('app-ctx-tr-st', 'circle-stroke-color', lc);
    P('app-ctx-tr-st', 'circle-stroke-opacity', ['case', ['==', ['get', 's'], 'existente'], 1, 0.7]);
    const h = halo(); Object.keys(h).forEach(k => P('app-ctx-tr-lab', k, k === 'text-color' ? ['case', ['==', ['get', 's'], 'existente'], ink, ink2] : h[k]));
    if (R.camHas('trilhos')) this.onMove(H);
  },
  onMove(H) {
    if (C.tr || C.trP) return;
    C.trP = get('transporte.json').then(t => { C.tr = t; const d = trData(); setSrc(H.map, 'app-ctx-tr-ln', d.ln); setSrc(H.map, 'app-ctx-tr-stsrc', d.st); setSrc(H.map, 'app-ctx-bus', d.bus);
      if (R.S.view === 'cidade' && R.camHas('trilhos') && R.renderCityLegend) R.renderCityLegend(); })   // a legenda passa a listar as linhas
      .catch(e => { C.trP = null; ctxErr('transporte', e); });
  },
  setVisible(H, on) { const bus = on && R.camHas('trilhos:bus'); TRL.forEach(id => R.visL(H.map, id, id.startsWith('app-ctx-bus') ? bus : on)); },
  hitLayers: () => ['app-ctx-tr-st', 'app-ctx-bus-t', 'app-ctx-tr-ex', 'app-ctx-tr-ob', 'app-ctx-tr-pl', 'app-ctx-bus-c'],
  tip(f) {
    const p = f.properties, foot = `GeoSampa (CC BY-SA 4.0), ${DATE_GS} · distâncias em linha reta`;
    if (f.layer.id === 'app-ctx-tr-st') return R.tip(p.nm, [['Linha', p.ln + ' · ' + p.md], ['Status', TR_ST[p.s] || p.s]], foot);
    if (f.layer.id === 'app-ctx-bus-t') return R.tip(p.nm, [['Terminal de ônibus', p.tp || '—']], foot);
    if (f.layer.id === 'app-ctx-bus-c') return R.tip(p.nm, [['Corredor de ônibus', p.st || '—']], 'GeoSampa/SPTrans, out/2025');
    return R.tip(lineLab(p.l, p.n) || 'Linha', [['Modo', p.m], ['Status', TR_ST[p.s] || p.s]], foot);
  },
  click(f) { if (f.layer.id === 'app-ctx-tr-st' || f.layer.id === 'app-ctx-bus-t') { const c = f.geometry.coordinates; R.cityMap.easeTo({center: c, zoom: Math.max(R.cityMap.getZoom(), 15)}); } },
  legend: () => {   // uma entrada por linha presente nos dados (traço na cor oficial, no melhor status da linha); depois os glifos de status, em tinta
    const L = C.tr ? trLinhas() : [];
    const linhas = L.length ? L.map(l => `<span class="it">${lkSvg(l.s === 'existente' ? 'ex' : l.s === 'em_obra' ? 'ob' : 'pl', 18, l.cor || 'var(--ink-2)')}${esc(l.lab)}</span>`).join('')
      : `<span class="it">${lkSvg('ex')}metrô e trem (cor oficial por linha)</span>`;
    return linhas + `<span class="it">${lkSvg('ex')}existente</span><span class="it">${lkSvg('ob')}em obra (lista manual, a validar)</span><span class="it">${lkSvg('pl')}planejada (GeoSampa)</span>` +
      (R.camHas('trilhos:bus') ? `<span class="it"><i class="ctx-sq"></i>terminal de ônibus · ${lkSvg('bus', 16)}corredor de ônibus</span>` : '') + `<span class="it muted">GeoSampa, ${DATE_GS}</span>`;
  },
  note: () => 'em obra = lista manual (Linhas 6, 17 e 2) a validar; sem previsão de entrega',
});

/* ════════ camada: zoneamento (Lei 18.177/2024) ═══════════ */
const ZL = ['app-ctx-zeF', 'app-ctx-zeL', 'app-ctx-zeP', 'app-ctx-zF', 'app-ctx-zL', 'app-ctx-zO', 'app-ctx-zH', 'app-ctx-zeH'];
function zonFC(j) {
  const zs = C.meta.zonas, fs = [];
  for (let i = 0; i < j.z.length; i++) {
    const z = zs[j.z[i]]; if (!z) continue;
    fs.push({type: 'Feature', geometry: geomOf(j.g[i]), properties: {z: j.z[i], g7: z.g7, prev: /^ZE(U|M)P/.test(z.z) && !j.a[i] ? 1 : 0, a: j.a[i], o: j.o[i]}});
  }
  return fs;
}
function zonRefresh(H) {
  const map = H.map, z = map.getZoom();
  if (C.zonE) { if (!C.sets.ze) { C.sets.ze = 1; setSrc(map, 'app-ctx-ze', C.zonE); } }
  else if (z >= 10.5 && !C.zonEP) C.zonEP = get('zon/eixos.json').then(j => { C.zonE = C.zonE || {type: 'FeatureCollection', features: zonFC(j)}; C.sets.ze = 1; setSrc(map, 'app-ctx-ze', C.zonE); })
    .catch(e => { C.zonEP = null; ctxErr('zoneamento (eixos)', e); });
  if (z < 12.5) return;
  const cds = bbHit(C.meta.zbb, viewBox(map)).slice(0, 14), key = cds.sort().join(',');
  Promise.allSettled(cds.map(cd => C.zon[cd] ? Promise.resolve() : get(`zon/${cd}.json`).then(j => { C.zon[cd] = zonFC(j); }))).then(rs => {
    const bad = rs.find(r => r.status === 'rejected'); if (bad) ctxErr('zoneamento', bad.reason);
    if (C.sets.zk === key) return;
    if (!bad) C.sets.zk = key;   // com falha, a próxima movimentação tenta de novo
    setSrc(map, 'app-ctx-z', {type: 'FeatureCollection', features: cds.flatMap(cd => C.zon[cd] || [])});
  });
}
const patExpr = ['match', ['get', 'g7'], 'eixo', 'ctx-pat-eixo', 'centr', 'ctx-pat-centr', 'zer', 'ctx-pat-zer', 'zeis', 'ctx-pat-zeis', 'ind', 'ctx-pat-ind', 'prot', 'ctx-pat-prot', 'ctx-pat-eixo'];
regLayer({
  id: 'zoneamento', group: 'Contexto', order: 2, label: 'Zoneamento (Lei 18.177/24)', minzoom: 11,
  title: 'Zonas da Lei 18.177/2024 (perímetros GeoSampa de 28/03/2025) em 7 grupos por hachura; eixos a partir do zoom 11, demais a partir do 13. CA e gabarito: Quadro 3 da Lei 16.402/2016 na redação da 18.081/2024',
  add(H, below) {
    const map = H.map; putImages(map);
    src(map, 'app-ctx-ze', C.zonE, ['ze']); src(map, 'app-ctx-z', null, ['zk']);
    const w = ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 0.9, 17, 1.4];
    R.addLayerOnce(map, {id: 'app-ctx-zF', type: 'fill', source: 'app-ctx-z', minzoom: 13, filter: ['match', ['get', 'g7'], ['mista', 'outros'], false, true], paint: {'fill-pattern': patExpr, 'fill-opacity': 0.9}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zH', type: 'fill', source: 'app-ctx-z', minzoom: 13, paint: {'fill-color': '#000', 'fill-opacity': 0.001}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zL', type: 'line', source: 'app-ctx-z', minzoom: 13, filter: ['!=', ['get', 'g7'], 'outros'], paint: {'line-width': w}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zO', type: 'line', source: 'app-ctx-z', minzoom: 13, filter: ['==', ['get', 'g7'], 'outros'], paint: {'line-width': w, 'line-dasharray': [1, 2]}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zeF', type: 'fill', source: 'app-ctx-ze', minzoom: 11, paint: {'fill-pattern': ['case', ['==', ['get', 'prev'], 1], 'ctx-pat-eixoP', 'ctx-pat-eixo'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 0.85]}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zeH', type: 'fill', source: 'app-ctx-ze', minzoom: 11, paint: {'fill-color': '#000', 'fill-opacity': 0.001}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zeL', type: 'line', source: 'app-ctx-ze', minzoom: 11, filter: ['==', ['get', 'prev'], 0], paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 0.9, 17, 1.3]}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-zeP', type: 'line', source: 'app-ctx-ze', minzoom: 11, filter: ['==', ['get', 'prev'], 1], paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 0.9, 17, 1.2], 'line-dasharray': [1, 1.6]}}, below);
  },
  update(H) {
    const map = H.map; putImages(map);
    const P = (id, k, v) => { if (map.getLayer(id)) map.setPaintProperty(id, k, v); };
    P('app-ctx-zL', 'line-color', css('--ink-2')); P('app-ctx-zL', 'line-opacity', ['case', ['==', ['get', 'g7'], 'mista'], 0.35, 0.6]);
    P('app-ctx-zO', 'line-color', css('--ink-2')); P('app-ctx-zO', 'line-opacity', 0.5);
    P('app-ctx-zeL', 'line-color', css('--ink')); P('app-ctx-zeL', 'line-opacity', ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.6]); P('app-ctx-zeP', 'line-color', css('--ink-2')); P('app-ctx-zeP', 'line-opacity', 0.6);
    if (R.camHas('zoneamento') && C.meta) zonRefresh(H);
    else if (R.camHas('zoneamento')) meta().then(() => zonRefresh(H)).catch(e => ctxErr('meta', e));
  },
  onMove(H) { if (C.meta) zonRefresh(H); },
  setVisible(H, on) { ZL.forEach(id => R.visL(H.map, id, on)); },
  hitLayers: () => ['app-ctx-zeH', 'app-ctx-zH'],
  tip(f) {
    const z = C.meta && C.meta.zonas[f.properties.z]; if (!z) return null;
    const gab = z.livre ? 'sem limite (NA no Quadro 3)' : z.gab != null ? nf0.format(z.gab) + ' m' : '—';
    const ca = v => v == null ? '—' : nf1.format(v).replace(',0', '');
    const rows = [['Grupo', C.meta.g7[z.g7] || z.grupo], ['CA mínimo · básico · máximo', `${ca(z.ca_min)} · ${ca(z.ca_bas)} · ${ca(z.ca_max)}`], ['Gabarito', gab],
      ['Taxa de ocupação (lote ≤ 500 m² / maior)', z.to && z.to[0] != null ? `${nf0.format(z.to[0] * 100)}% / ${nf0.format((z.to[1] || z.to[0]) * 100)}%` : '—']];
    if (/^ZE(U|M)P/.test(z.z)) rows.push(['Eixo previsto', f.properties.a ? 'ativado por decreto (vale como ZEU/ZEM)' : 'não ativado (vale o CA da linha própria)']);
    if (f.properties.o >= 0) rows.push(['Operação urbana', C.meta.ouc[f.properties.o] || '—']);
    if (z.nota) rows.push(['Nota do Quadro 3', z.nota]);
    return R.tip(`${z.z} · ${z.nome}`, rows, `Lei ${z.lei} (perímetro GeoSampa de ${String(z.dt || '').split('-').reverse().join('/')}) · parâmetros: Quadro 3 da Lei 16.402/2016, redação da 18.081/2024`);
  },
  click(f) { const c = anchorOf(f); if (c) { const cd = distAt(c[0], c[1]); if (cd) R.openDist(cd); } },
  legend: () => `<span class="it ctx-zleg"><b>Zoneamento</b>${G7.filter(g => g !== 'outros').map(g => `<span class="it"><i class="ctx-sw${g === 'eixo' ? ' strong' : ''}" style="background:${G7SW[g]}"></i>${esc({eixo: 'eixos', centr: 'centralidades', mista: 'mistas', zer: 'ZER/ZPR', zeis: 'ZEIS', ind: 'industriais', prot: 'proteção'}[g])}</span>`).join('')}` +
    `<span class="it muted">eixo previsto não ativado = hachura rala e contorno pontilhado · eixos no zoom ≥ 11, demais ≥ 13 · Lei 18.177/24</span></span>`,
  note: () => 'hachura por grupo (sem cor); passe o mouse para CA, gabarito e lei',
});
function anchorOf(f) {
  const g = f.geometry; if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.type === 'LineString' ? g.coordinates : null;
  if (!ring || !ring.length) return null;
  let x = 0, y = 0; ring.forEach(p => { x += p[0]; y += p[1]; }); return [x / ring.length, y / ring.length];
}

/* ════════ camada: equipamentos e serviços (ícones no zoom ≥ 16) ═════ */
const subOn = s => R.camHas('pois:' + s);
function poiFeatures(cd) {
  if (C.poiFC[cd]) return C.poiFC[cd];
  const pr = {escola: 1, saude: 2, abast: 3, seg: 4, pub: 5, parque: 6, cemit: 9};
  return (C.poiFC[cd] = C.poi[cd].map((p, i) => ({type: 'Feature', geometry: {type: 'Point', coordinates: p.p},
    properties: {cd, i, sub: p.c.sub, im: `ctx-i-${p.c.k}-${p.s === 2 ? 's' : 'c'}`, b: p.b || '', o: pr[p.c.sub] || 8}})));
}
function parqueFeatures() {
  if (C.parqFC) return C.parqFC;
  return (C.parqFC = C.parques.p.map((p, i) => ({type: 'Feature', geometry: {type: 'Point', coordinates: p.c}, properties: {cd: '_pq', i, sub: 'parque', im: 'ctx-i-parque-c', b: '', o: 6}})));
}
function poiRefresh(H) {
  const map = H.map; if (map.getZoom() < 15.5) return;
  const cds = bbHit(C.meta.pbb, viewBox(map)).slice(0, 10);
  const needP = C.parques ? Promise.resolve() : get('parques.json').then(j => { C.parques = j; });
  Promise.allSettled([needP].concat(cds.map(cd => C.poi[cd] ? Promise.resolve() : get(`poi/${cd}.json`).then(j => poiDecode(cd, j))))).then(rs => {
    const bad = rs.find(r => r.status === 'rejected'); if (bad) ctxErr('equipamentos', bad.reason);
    const key = cds.sort().join(',');
    if (C.sets.pk === key) return;
    if (!bad) C.sets.pk = key;
    setSrc(map, 'app-ctx-poi', {type: 'FeatureCollection', features: cds.flatMap(cd => C.poi[cd] ? poiFeatures(cd) : []).concat(C.parques ? parqueFeatures() : [])});
  });
}
function poiFilter() { const on = SUBS.map(s => s[0]).filter(subOn); return ['in', ['get', 'sub'], ['literal', on]]; }
regLayer({
  id: 'pois', group: 'Contexto', order: 3, label: 'Equipamentos e serviços', minzoom: 16,
  title: 'Escolas, saúde, abastecimento, parques, segurança e prédios públicos (subconjunto decisivo, A4 §7); o resto sob demanda. ● = fonte oficial (GeoSampa/CNES); ■ = OpenStreetMap (cobertura desigual)',
  subs: SUBS.map(([id, l]) => ({id, html: `${icoHtml(SUB_ICO[id], OSM_SUB.has(id), id === 'cemit')} ${esc(l)}${OSM_SUB.has(id) ? ' <small>OSM</small>' : ''}`, def: false})),
  add(H) {
    const map = H.map;
    src(map, 'app-ctx-poi', null, ['pk']);
    R.addLayerOnce(map, {id: 'app-ctx-poi', type: 'symbol', source: 'app-ctx-poi', minzoom: 16,
      layout: {'icon-image': ['get', 'im'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 1, 18, 1.2], 'icon-allow-overlap': false, 'icon-padding': 1,
        'symbol-sort-key': ['get', 'o'], 'text-field': ['step', ['zoom'], '', 17, ['get', 'b']], 'text-font': styleFont(map), 'text-size': 10.5,
        'text-anchor': 'left', 'text-offset': [1.1, 0], 'text-optional': true}});
  },
  update(H) {
    const map = H.map; putImages(map);
    const on = R.camHas('pois');
    if (on && !C.wasOn.pois && !SUBS.some(s => subOn(s[0]))) {   // ligada sem sub-opção (vista pronta, URL): o subconjunto decisivo
      DECISIVO.forEach(s => R.S.cam.add('pois:' + s)); setTimeout(() => R.render(), 0);
    }
    C.wasOn.pois = on;
    if (map.getLayer('app-ctx-poi')) { map.setFilter('app-ctx-poi', poiFilter()); const h = halo(); Object.keys(h).forEach(k => map.setPaintProperty('app-ctx-poi', k, h[k])); }
    if (on) (C.meta ? Promise.resolve() : meta()).then(() => { putImages(map); poiRefresh(H); }).catch(e => ctxErr('meta', e));
  },
  onMove(H) { if (C.meta) poiRefresh(H); },
  setVisible(H, on) { R.visL(H.map, 'app-ctx-poi', on); },
  hitLayers: () => ['app-ctx-poi'],
  tip(f) {
    const p = f.properties;
    if (p.cd === '_pq') { const q = C.parques.p[p.i]; return R.tip(q.n, [['Categoria', q.t || 'parque'], ['Área', q.a ? nf1.format(q.a / 1e4) + ' ha' : '—']], `GeoSampa (CC BY-SA 4.0), ${DATE_GS} · distância na régua = até a borda`); }
    const q = (C.poi[p.cd] || [])[p.i]; if (!q) return null;
    const rows = [['Categoria', q.c.l]]; if (q.a) rows.push(['Detalhe', q.a]);
    return R.tip(q.n || '(sem nome na fonte)', rows, srcLab(q.s));
  },
  legend: () => {
    const on = SUBS.filter(s => subOn(s[0]));
    return `<span class="it">${on.map(s => icoHtml(SUB_ICO[s[0]], OSM_SUB.has(s[0]), s[0] === 'cemit')).join('')} equipamentos (zoom ≥ 16)</span><span class="it muted">● GeoSampa/CNES · ■ OpenStreetMap: cobertura desigual (menor na periferia); ausência no OSM não é ausência real</span>`;
  },
  note: () => 'zoom ≥ 16 · ● oficial · ■ OSM (cobertura desigual)',
});

/* ════════ camada: regiões comerciais (IPTU) ══════════════ */
const COM_T = ['corredor comercial', 'face comercial', 'polo'];
function comRefresh(H) {
  const map = H.map;
  const put = () => { setSrc(map, 'app-ctx-com', C.comFC); setSrc(map, 'app-ctx-comL', C.comLab); };
  if (C.comFC || C.comP) return;
  C.comP = (C.com ? Promise.resolve(C.com) : get('comercial.json')).then(j => {
    C.com = j;
    C.comFC = {type: 'FeatureCollection', features: j.f.map((f, i) => ({type: 'Feature', geometry: f.l ? {type: 'LineString', coordinates: f.l} : geomOf(f.g), properties: {i, t: f.t}}))};
    C.comLab = {type: 'FeatureCollection', features: j.f.filter(f => f.t === 2).map(f => ({type: 'Feature', geometry: {type: 'Point', coordinates: f.c}, properties: {n: 'polo ' + ({'escritórios': 'de escritórios', varejo: 'de varejo', misto: 'misto'}[f.p] || '')}}))};
    put();
  }).catch(e => { C.comP = null; ctxErr('regiões comerciais', e); });
}
const COML = ['app-ctx-comH', 'app-ctx-comC', 'app-ctx-comFa', 'app-ctx-comP', 'app-ctx-comPH', 'app-ctx-comLab'];
regLayer({
  id: 'comercial', group: 'Contexto', order: 4, label: 'Regiões comerciais (IPTU)',
  title: 'Corredores (trechos de rua com ≥ 6 lotes e ≥ 50% com varejo), faces isoladas (zoom ≥ 14) e polos de varejo/escritório (≥ 5 ha). IPTU 2026; definição do A4 §6',
  add(H) {
    const map = H.map;
    src(map, 'app-ctx-com', C.comFC); src(map, 'app-ctx-comL', C.comLab);
    const lineT = ['==', ['geometry-type'], 'LineString'];
    R.addLayerOnce(map, {id: 'app-ctx-comP', type: 'line', source: 'app-ctx-com', maxzoom: 15.5, filter: ['==', ['get', 't'], 2], paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 1.8], 'line-dasharray': [4, 2.5]}});
    R.addLayerOnce(map, {id: 'app-ctx-comPH', type: 'fill', source: 'app-ctx-com', maxzoom: 15.5, filter: ['==', ['get', 't'], 2], paint: {'fill-color': '#000', 'fill-opacity': 0.001}});
    R.addLayerOnce(map, {id: 'app-ctx-comC', type: 'line', source: 'app-ctx-com', minzoom: 12, maxzoom: 16.5, filter: ['all', ['==', ['get', 't'], 0], lineT], layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 15, 6, 17, 10]}});
    R.addLayerOnce(map, {id: 'app-ctx-comFa', type: 'line', source: 'app-ctx-com', minzoom: 14, maxzoom: 16.5, filter: ['all', ['==', ['get', 't'], 1], lineT], layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3.5, 17, 8]}});
    R.addLayerOnce(map, {id: 'app-ctx-comH', type: 'line', source: 'app-ctx-com', minzoom: 12, maxzoom: 16.5, filter: ['all', ['<', ['get', 't'], 2], lineT], paint: {'line-width': 14, 'line-opacity': 0.001, 'line-color': '#000'}});
    R.addLayerOnce(map, {id: 'app-ctx-comLab', type: 'symbol', source: 'app-ctx-comL', minzoom: 12, maxzoom: 16,
      layout: {'text-field': ['get', 'n'], 'text-font': styleFont(map), 'text-size': 10.5, 'text-max-width': 8, 'text-optional': true}});
  },
  update(H) {
    const map = H.map, P = (id, k, v) => { if (map.getLayer(id)) map.setPaintProperty(id, k, v); };
    P('app-ctx-comC', 'line-color', css('--ink')); P('app-ctx-comC', 'line-opacity', 0.28);
    P('app-ctx-comFa', 'line-color', css('--ink')); P('app-ctx-comFa', 'line-opacity', 0.2);
    P('app-ctx-comP', 'line-color', css('--ink-2')); P('app-ctx-comP', 'line-opacity', 0.75);
    const h = halo(); Object.keys(h).forEach(k => P('app-ctx-comLab', k, k === 'text-color' ? css('--ink-2') : h[k]));
    if (R.camHas('comercial')) comRefresh(H);
  },
  onMove(H) { comRefresh(H); },
  setVisible(H, on) { COML.forEach(id => R.visL(H.map, id, on)); },
  hitLayers: () => ['app-ctx-comH', 'app-ctx-comPH'],
  tip(f) {
    const r = C.com && C.com.f[f.properties.i]; if (!r) return null;
    const rows = [['Tipo', COM_T[r.t] + (r.p ? ' · ' + r.p : '')], ['Lotes (com varejo)', `${nf0.format(r.nl)} (${nf0.format(r.nv)})`],
      ['Varejo · escritório', `${fM2k(r.v)} · ${fM2k(r.e)}`], ['Lotes em zona central (ZC, ZCOR, eixos)', r.zc != null ? nf0.format(r.zc) + '%' : '—']];
    if (r.ha) rows.push(['Área', nf0.format(r.ha) + ' ha']);
    return R.tip(r.n, rows, 'IPTU 2026 (uso e área construída) · A4 §6');
  },
  click(f) { const c = anchorOf(f); if (c) { const cd = distAt(c[0], c[1]); if (cd) R.openDist(cd); } },
  legend: () => `<span class="it"><i class="ctx-band"></i>corredor comercial (traço largo sobre a rua; zoom ≥ 12)</span><span class="it">${lkSvg('polo', 20)}polo de varejo/escritório</span><span class="it muted">faces isoladas: zoom ≥ 14; traços até o zoom 16 · IPTU 2026</span>`,
});
const fM2k = v => v == null ? '—' : v >= 1e6 ? nf1.format(v / 1e6) + ' mi m²' : v >= 1e4 ? nf0.format(v / 1e3) + ' mil m²' : nf0.format(v) + ' m²';

/* ════════ camadas de densidade por hexágono (fill: escala contínua própria) ═════ */
function hexFC(j, per) {
  const s = j.r, fs = [];
  for (let i = 0; i < j.q.length; i++) {
    const q = j.q[i], r = j.rr[i], cx = s * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r), cy = s * 1.5 * r;
    const ring = []; for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); ring.push([(cx + s * Math.cos(a)) / j.kx + j.lon0, (cy + s * Math.sin(a)) / j.ky + j.lat0]); }
    ring.push(ring[0]);
    fs.push({type: 'Feature', geometry: {type: 'Polygon', coordinates: [ring]}, properties: {i, v: j.v[i] / per, n: j.v[i], cx: cx / j.kx + j.lon0, cy: cy / j.ky + j.lat0}});
  }
  return {type: 'FeatureCollection', features: fs};
}
function densLayer(o) {
  const sid = 'app-ctx-' + o.id, lid = sid + '-f';
  const dom = () => { const d = C.dens[o.id]; if (!d) return null; const v = d.fc.features.map(f => f.properties.v).filter(x => x > 0).sort((a, b) => a - b); return [R.qt(v, 0.1), R.qt(v, 0.98)]; };
  const colorExpr = () => {
    const d = dom(), stops = R.PALS[o.pal](); if (!d) return css('--gray-cell');
    const [lo, hi] = d, L = Math.log(lo), U = Math.log(hi), e = ['interpolate', ['linear'], ['ln', ['max', ['get', 'v'], lo]]];
    stops.forEach((c, k) => e.push(L + (U - L) * k / (stops.length - 1), c));
    return ['case', ['<=', ['get', 'v'], 0], stops[0], e];
  };
  regLayer({
    id: o.id, group: 'Contexto', order: o.order, label: o.label, fill: true, title: o.title,
    add(H, below) {
      const map = H.map;
      src(map, sid, C.dens[o.id] && C.dens[o.id].fc);
      R.addLayerOnce(map, {id: lid, type: 'fill', source: sid, paint: {'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.72, 13, 0.5, 15, 0.16]}}, below);
      R.addLayerOnce(map, {id: lid + 'l', type: 'line', source: sid, minzoom: 11.5, paint: {'line-width': 0.5, 'line-opacity': 0.5}}, below);
    },
    update(H) {
      const map = H.map;
      if (map.getLayer(lid)) { map.setPaintProperty(lid, 'fill-color', colorExpr()); map.setPaintProperty(lid + 'l', 'line-color', css('--surface')); }
      if (!R.camHas(o.id)) return;
      if (C.dens[o.id] || C.dens[o.id + 'P']) return;
      C.dens[o.id + 'P'] = get(o.file).then(j => { C.dens[o.id] = {j, fc: hexFC(j, o.per(j))}; setSrc(map, sid, C.dens[o.id].fc); R.render(); })
        .catch(e => { C.dens[o.id + 'P'] = null; ctxErr(o.label, e); });
    },
    setVisible(H, on) { R.visL(H.map, lid, on); R.visL(H.map, lid + 'l', on); },
    hitLayers: () => [lid],
    tip(f) { const d = C.dens[o.id]; return d ? o.tip(f.properties, d.j) : null; },
    click(f) { const cd = distAt(f.properties.cx, f.properties.cy); if (cd) R.openDist(cd); },
    legend() {
      const d = dom(); if (!d) return `<span class="it muted">${esc(o.label)}: carregando…</span>`;
      return `<span class="scale"><b style="font-weight:500;color:var(--ink)">${esc(o.legend)}</b> ${esc(o.fmt(d[0]))}<span class="g" style="background:${R.gradCss(R.PALS[o.pal]())}"></span>${esc(o.fmt(d[1]))} (log)</span><span class="it muted">${o.caveat}</span>`;
    },
    note: () => o.note,
  });
}
densLayer({id: 'roubos', order: 6, label: 'Roubos registrados (densidade)', file: 'dens_roubos.json', pal: 'heat', per: j => j.km2,
  title: 'Boletins de roubo de 2025 por km², hexágonos de ~22 ha (SSP-SP, BO único, coordenada da SSP). Mede exposição, não risco pessoal; há subnotificação',
  legend: 'Roubos registrados por km² (SSP 2025, hexágono ~22 ha)', fmt: v => nf0.format(v),
  caveat: 'normalizado por área (não por população): áreas de comércio e passagem concentram registros · subnotificação · 88% dos roubos têm coordenada',
  note: 'BO/km² · SSP 2025 · subnotificação',
  tip: (p, j) => R.tip('Roubos registrados em 2025', [['Neste hexágono (~22 ha)', nf0.format(p.n) + ' BOs'], ['Por km²', nf0.format(p.v)]], 'SSP-SP, SPDadosCriminais 2025 (BO único) · exposição, não risco pessoal; subnotificação')});
densLayer({id: 'varejo', order: 7, label: 'Varejo (densidade, IPTU)', file: 'dens_varejo.json', pal: 'seq', per: j => j.ha,
  title: 'm² construídos de lojas (IPTU 2026) por hectare, hexágonos de ~22 ha. Medida oficial de comércio; o OSM é enviesado (A4 §2)',
  legend: 'Varejo: m² de lojas por hectare (IPTU 2026)', fmt: v => nf0.format(v),
  caveat: 'IPTU 2026 (loja, loja em condomínio, posto) · medida oficial; a contagem do OSM é enviesada por região',
  note: 'm²/ha · IPTU 2026 (não OSM)',
  tip: (p) => R.tip('Varejo (IPTU 2026)', [['Neste hexágono (~22 ha)', fM2k(p.n) + ' de lojas'], ['Por hectare', nf0.format(p.v) + ' m²']], 'IPTU 2026 · área construída de uso comercial varejista')});

/* ════════ camada: riscos (inundação TR 25 e setores de risco) ═════ */
function riscoRefresh(H) {
  const map = H.map, z = map.getZoom();
  if (!C.riscos && !C.riscosP) C.riscosP = get('riscos.json').then(j => {
    C.riscos = j; C.riscoFC = {type: 'FeatureCollection', features: j.geo.map((r, i) => ({type: 'Feature', geometry: geomOf(r.g), properties: {k: 'geo', i}}))
      .concat(j.hid.map((r, i) => ({type: 'Feature', geometry: geomOf(r.g), properties: {k: 'hid', i}})))};
    setSrc(map, 'app-ctx-rs', C.riscoFC);
  }).catch(e => { C.riscosP = null; ctxErr('riscos', e); });
  if (z < 12.5 || !C.meta) return;
  const cds = bbHit(C.meta.ibb, viewBox(map)).slice(0, 14), key = cds.sort().join(',');
  Promise.allSettled(cds.map(cd => C.inund[cd] ? Promise.resolve() : get(`inund/${cd}.json`).then(j => { C.inund[cd] = j.g.map((g, i) => ({type: 'Feature', geometry: geomOf(g), properties: {p: j.p[i]}})); }))).then(rs => {
    if (C.sets.ik === key) return; if (!rs.some(r => r.status === 'rejected')) C.sets.ik = key;
    setSrc(map, 'app-ctx-in', {type: 'FeatureCollection', features: cds.flatMap(cd => C.inund[cd] || [])});
  });
}
const RSL = ['app-ctx-inF', 'app-ctx-inL', 'app-ctx-rsF', 'app-ctx-rsL'];
regLayer({
  id: 'riscos', group: 'Contexto', order: 8, label: 'Riscos: inundação e encostas', minzoom: 12,
  title: 'Mancha de inundação para chuva de retorno de 25 anos (modelagem GeoSampa, ago/2026; zoom ≥ 13) e setores de risco geológico e hidrológico (vistorias da Prefeitura)',
  add(H, below) {
    const map = H.map; putImages(map);
    src(map, 'app-ctx-in', null, ['ik']); src(map, 'app-ctx-rs', C.riscoFC);
    R.addLayerOnce(map, {id: 'app-ctx-inF', type: 'fill', source: 'app-ctx-in', minzoom: 13, paint: {'fill-pattern': 'ctx-pat-inund'}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-inL', type: 'line', source: 'app-ctx-in', minzoom: 13, paint: {'line-width': 0.8, 'line-opacity': 0.7}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-rsF', type: 'fill', source: 'app-ctx-rs', minzoom: 12, paint: {'fill-pattern': ['match', ['get', 'k'], 'geo', 'ctx-pat-geo', 'ctx-pat-hid']}}, below);
    R.addLayerOnce(map, {id: 'app-ctx-rsL', type: 'line', source: 'app-ctx-rs', minzoom: 12, paint: {'line-width': 1.1}}, below);
  },
  update(H) {
    const map = H.map; putImages(map);
    const crit = css('--ctx-crit') || '#d03b3b';
    if (map.getLayer('app-ctx-inL')) map.setPaintProperty('app-ctx-inL', 'line-color', crit);
    if (map.getLayer('app-ctx-rsL')) map.setPaintProperty('app-ctx-rsL', 'line-color', crit);
    if (R.camHas('riscos')) (C.meta ? Promise.resolve() : meta()).then(() => riscoRefresh(H)).catch(e => ctxErr('meta', e));
  },
  onMove(H) { riscoRefresh(H); },
  setVisible(H, on) { RSL.forEach(id => R.visL(H.map, id, on)); },
  hitLayers: () => ['app-ctx-rsF', 'app-ctx-inF'],
  tip(f) {
    if (f.layer.id === 'app-ctx-inF') return R.tip('Mancha de inundação (retorno de 25 anos)', [['Profundidade máxima modelada', f.properties.p ? nf1.format(f.properties.p) + ' m' : '—']], `GeoSampa, modelagem de ${esc(C.meta && C.meta.notas.inund || '2026')} · agregada em células de 20 m`);
    const r = C.riscos && C.riscos[f.properties.k][f.properties.i]; if (!r) return null;
    return R.tip(r.n || 'Setor de risco', [['Tipo', f.properties.k === 'geo' ? 'geológico (' + (r.p || '—') + ')' : 'hidrológico (' + (r.p || '—') + ')'], ['Grau', r.r || '—'], ['Moradias no setor', r.m != null ? nf0.format(r.m) : '—'], ['Vistoria', r.v ? r.v.split('-').reverse().join('/') : '—']], 'GeoSampa (CC BY-SA 4.0) · setores mapeados pela Prefeitura');
  },
  click(f) { const c = anchorOf(f); if (c) { const cd = distAt(c[0], c[1]); if (cd) R.openDist(cd); } },
  legend: () => `<span class="it"><i class="ctx-sw" style="background:radial-gradient(circle, var(--ctx-crit) 1px, transparent 1.3px) 0 0/4px 4px"></i>mancha de inundação TR 25 (zoom ≥ 13)</span><span class="it"><i class="ctx-sw" style="background:repeating-linear-gradient(45deg, var(--ctx-crit) 0 1px, transparent 1px 5px),repeating-linear-gradient(135deg, var(--ctx-crit) 0 1px, transparent 1px 5px)"></i>risco geológico</span><span class="it"><i class="ctx-sw" style="background:repeating-linear-gradient(135deg, var(--ctx-crit) 0 1px, transparent 1px 5px)"></i>risco hidrológico</span><span class="it muted">GeoSampa, ago–set/2026</span>`,
});

/* ── vista pronta ─────────────────────────────────────────── */
R.registerPreset({id: 'contexto', label: 'Contexto', order: 60, met: 'none', cam: ['trilhos', 'zoneamento', 'pois'],
  title: 'Metrô e trem (existente, em obra a validar, planejado), zoneamento (eixos a partir do zoom 11) e equipamentos (zoom ≥ 16); cor dos distritos desligada'});

function ctxErr(what, e) { if (C.err[what]) return; C.err[what] = 1; console.warn('contexto', what, e); R.toast(`Contexto: ${what} indisponível (abra pelo serve.py: contexto/*.json)`); }

/* ════════ seção "O que tem perto" (Prédio e Lançamento) ════ */
const MOB = [
  {k: 'trilho', l: 'Metrô e trem', g: 'Mobilidade', st: 'existente'},
  {k: 'obra', l: 'Metrô em obra', g: 'Mobilidade', st: 'em_obra', tag: 'a validar'},
  {k: 'planejada', l: 'Metrô/trem planejado', g: 'Mobilidade', st: 'planejada', tag: 'sem previsão'},
  {k: 'term', l: 'Terminal de ônibus', g: 'Mobilidade'},
  {k: 'corr', l: 'Corredor de ônibus', g: 'Mobilidade'},
];
const RMAX = 1500;
function pctCloser(q, d) {   // % dos lotes com venda do distrito que ficam MAIS LONGE que d (quantis p0…p100 de 5 em 5)
  if (!q || d == null || !isFinite(d)) return null;
  if (d < q[0]) return 100;
  if (d >= q[20]) return 0;
  let i = 0; while (i < 19 && q[i + 1] <= d) i++;
  const span = q[i + 1] - q[i], f = span > 0 ? (d - q[i]) / span : 1;
  return Math.round(100 - (i + f) * 5);
}
function pctAbove(q, v) { const p = pctCloser(q, v); return p == null ? null : 100 - p; }   // % com valor MENOR que v
function nearAll(p, cds, M) {
  const out = {}, P = toM(p);
  // mobilidade
  const stn = C.tr.st, groups = {};
  stn.forEach(s => {
    const d = dm(p, [s[5], s[6]]);
    const k = s[4] === 'existente' ? 'trilho' : s[4] === 'em_obra' ? 'obra' : 'planejada';
    const g = groups[k] = groups[k] || new Map(), key = s[0];
    const e = g.get(key); const ln = lineLab(s[1], s[2]);
    if (!e) g.set(key, {n: s[0], d, a: ln, x: ln, s: 0, k: linhaKey(s[1])}); else { if (!e.a.includes(ln)) e.x = e.a += ', ' + ln; if (d < e.d) { e.d = d; e.k = linhaKey(s[1]); } }
  });
  ['trilho', 'obra', 'planejada'].forEach(k => { out[k] = [...(groups[k] || new Map()).values()].sort((a, b) => a.d - b.d); });
  out.term = C.tr.tm.map(s => ({n: s[0], d: dm(p, [s[2], s[3]]), a: s[1], s: 0})).sort((a, b) => a.d - b.d);
  out.corr = C.tr.co.map(c => ({n: c.n, d: distLineM(P, c._m || (c._m = c.c.map(toM))), a: c.s, s: 0}))
    .reduce((acc, e) => { const x = acc.find(y => y.n === e.n); if (!x) acc.push(e); else if (e.d < x.d) x.d = e.d; return acc; }, []).sort((a, b) => a.d - b.d);
  // equipamentos (poi/{cd}.json até RMAX) + parques (até a borda)
  M.cats.forEach(c => { out[c.k] = []; });
  cds.forEach(cd => (C.poi[cd] || []).forEach(q => { const d = dm(p, q.p); if (d <= RMAX) out[q.c.k].push({n: q.n, d, a: q.a, x: q.b ? 'IDEB ' + q.b : '', s: q.s}); }));
  if (C.parques) {
    const bx = boxAround(p, RMAX + 200);
    out.parque = parquesM().filter(o => !(o.bb[2] < bx[0] || o.bb[0] > bx[2] || o.bb[3] < bx[1] || o.bb[1] > bx[3]))
      .map(o => ({n: o.p.n, d: distRingsM(P, o.m), a: (o.p.t || 'parque') + (o.p.a ? ' · ' + nf1.format(o.p.a / 1e4) + ' ha' : ''), s: 0})).filter(e => e.d <= RMAX);
  }
  Object.values(out).forEach(a => a.sort((x, y) => x.d - y.d));
  return out;
}
function farNearest(k, p, lote, M) {   // nenhum até RMAX: o mais próximo está entre os candidatos do distrito (build)
  if (!lote || !lote.fp) return null;
  const ci = M.cats.findIndex(c => c.k === k); let best = null;
  lote.fp.forEach(r => {
    if (r[0] !== ci) return;
    let e;
    if (k === 'parque') { const o = C.parques && parquesM()[r[1]]; if (!o) return; e = {n: o.p.n, d: distRingsM(toM(p), o.m), a: o.p.t, s: 0}; }
    else e = {n: r[1], d: dm(p, [r[2] / 1e5, r[3] / 1e5]), a: r[4], s: r[5]};
    if (!best || e.d < best.d) best = e;
  });
  return best;
}
function ruler(list, nearest, q, far, neutral) {
  const X = d => Math.min(100, d / RMAX * 100);
  const dots = list.slice(0, 20).map((e, i) => `<i class="ctx-dot${i === 0 ? ' n1' : ''}" style="left:${X(e.d).toFixed(2)}%" title="${esc((e.n || '(sem nome)') + (e.a ? ' · ' + e.a : '') + ' · ' + fm(e.d))}"></i>`).join('');
  const med = q && q[10] <= RMAX ? `<i class="ctx-med" style="left:${X(q[10]).toFixed(2)}%" title="mediana dos prédios com venda do distrito: ${esc(fm(q[10]))}"></i>` : '';
  let lab = '';
  if (nearest) {
    const x = X(nearest.d), txt = `${nearest.n || '(sem nome)'}${nearest.x ? ' · ' + nearest.x : ''} · ${fm(nearest.d)}`;
    lab = far ? `<span class="ctx-lab far" title="${esc(txt + (nearest.a ? ' · ' + nearest.a : ''))}">→ ${esc(txt)}</span>`
      : `<span class="ctx-lab${x > 55 ? ' lft' : ''}" style="${x > 55 ? `right:${(100 - x + 1.2).toFixed(2)}%` : `left:${(x + 1.2).toFixed(2)}%`}" title="${esc(txt + (nearest.a ? ' · ' + nearest.a : ''))}">${esc(txt)}</span>`;
  } else lab = `<span class="ctx-lab far muted">nenhum no raio de busca</span>`;
  return `<div class="ctx-rul${neutral ? ' neu' : ''}"><i class="ctx-ax"></i>${med}${dots}${lab}</div>`;
}
const cnt = (a, r) => a.filter(e => e.d <= r).length;
function renderPerto(el, ctx, view) {
  const tok = (el._ctxTok = (el._ctxTok || 0) + 1);
  el.innerHTML = '<div class="loading">Carregando contexto urbano…</div>';
  const cd = ctx.cd || (ctx.lot && ctx.lot.cd) || null;
  meta().then(M => {
    const pt0 = ctx.lot && ctx.lot.c ? {p: ctx.lot.c, exato: true, lid: ctx.lot.id} : null;
    return Promise.all([get('transporte.json').then(t => { C.tr = t; }), C.parques ? null : get('parques.json').then(j => { C.parques = j; }),
      cd ? lotePromise(cd).catch(() => null) : null, C.com ? null : get('comercial.json').then(j => { C.com = j; }).catch(() => null)])
      .then(([, , lote]) => {
        const ids = (ctx.lotes || []).map(x => typeof x === 'string' ? x : x && (x.id || x.lot_id || x.lot)).filter(Boolean);
        const needF = !pt0 && view === 'lancamento' && cd && ids.length ? R.fetchDist(cd).catch(() => null) : Promise.resolve(null);
        return needF.then(F => {
        let pt = pt0;
        if (!pt && view === 'lancamento') {   // lote ligado ao lançamento (ponto do lote) ou, sem lote, a coordenada do empreendimento
          const L = F && ids.map(id => F.lots.find(l => l.id === id)).find(Boolean);
          const e = ctx.emp || {};
          const pos = ctx.ficha && ctx.ficha.pos;
          if (L) pt = {p: L.c, exato: true, lid: L.id};
          else if (pos && pos.x != null && pos.y != null) pt = {p: [+pos.x, +pos.y], exato: pos.src === 'lote', lid: ids[0] || null};
          else if (e.lat != null && (e.lng != null || e.lon != null)) pt = {p: [+(e.lng != null ? e.lng : e.lon), +e.lat], exato: false, lid: ids[0] || null};
        }
        if (!pt) { el.innerHTML = '<p class="sub">Sem lote nem coordenada para medir o entorno.</p>'; return; }
        const cdx = cd || distAt(pt.p[0], pt.p[1]);
        const cds = bbHit(M.pbb, boxAround(pt.p, RMAX));
        const lo = lote && pt.lid != null ? lote._ix.get(pt.lid) : undefined;
        const zP = lo == null ? zoneAt(pt.p, cdx).catch(() => null) : Promise.resolve(null);   // sem lote com venda: zona pelo polígono no ponto
        return Promise.all([Promise.allSettled(cds.map(c => C.poi[c] ? null : get(`poi/${c}.json`).then(j => poiDecode(c, j)))), zP]).then(([, zp]) => {
          if (el._ctxTok !== tok) return;
          R.safe('contexto: o que tem perto', () => { el.innerHTML = pertoHtml(M, pt, cds, lote, lo, cdx, zp); });
        });
        });
      });
  }).catch(e => { if (el._ctxTok === tok) el.innerHTML = `<p class="sub">Contexto urbano indisponível: abra pela URL do serve.py (arquivos contexto/*.json). <span class="muted">${esc(String(e && e.message || e))}</span></p>`; });
}
function zoneAt(p, cd) {
  return Promise.all([C.zonE ? null : get('zon/eixos.json').then(j => { if (!C.zonE) C.zonE = {type: 'FeatureCollection', features: zonFC(j)}; }),
    cd && !C.zon[cd] ? get(`zon/${cd}.json`).then(j => { C.zon[cd] = zonFC(j); }) : null]).then(() => {
    const fs = (C.zonE ? C.zonE.features : []).concat(cd ? (C.zon[cd] || []) : []);
    const f = fs.find(f => pip(p[0], p[1], f.geometry));
    return f ? f.properties : null;
  });
}
function pertoHtml(M, pt, cds, lote, lo, cd, zp) {
  const p = pt.p, N = nearAll(p, cds, M), Q = lote ? lote.q : {};
  const rows = MOB.concat(M.cats.map(c => ({k: c.k, l: c.l, g: c.g, osm: c.osm, gl: c.gl, neu: c.g.startsWith('Outros')})));
  let g0 = '', html = '';
  rows.forEach(r => {
    const list = N[r.k] || [];
    let nearest = list[0] || null, far = false;
    if (!nearest || nearest.d > RMAX) { const f = farNearest(r.k, p, lote, M); if (f) { nearest = f; far = true; } }
    if (nearest && nearest.d > RMAX) far = true;
    const within = list.filter(e => e.d <= RMAX);
    const q = Q[r.k] || null, pc = nearest ? pctCloser(q, nearest.d) : null;
    if (r.g !== g0) { html += `<div class="ctx-gh">${esc(r.g)}</div>`; g0 = r.g; }
    const gl = r.gl ? icoHtml(r.k, r.osm, r.neu) : r.st ? lkSvg(r.st === 'em_obra' ? 'ob' : r.st === 'planejada' ? 'pl' : 'ex', 17, nearest && nearest.k ? R.linhaCor(nearest.k) : undefined) : r.k === 'corr' ? lkSvg('bus', 17) : `<i class="ctx-sq mini"></i>`;
    html += `<div class="ctx-row${r.neu ? ' neu' : ''}"><span class="ctx-cl">${gl}<span>${esc(r.l)}${r.osm ? ' <small class="lic">OSM</small>' : ''}${r.tag ? ` <small class="lic">${esc(r.tag)}</small>` : ''}</span></span>` +
      ruler(within, nearest, q, far, r.neu) +
      `<span class="n">${nf0.format(cnt(within, 500))}</span><span class="n">${nf0.format(cnt(within, 1000))}</span>` +
      `<span class="n pc" title="${pc == null ? 'sem base no distrito' : `o mais próximo fica mais perto do que em ${pc}% dos prédios com venda do distrito (mediana ${fm(q[10])})`}">${pc == null ? '—' : pc + '%'}</span></div>`;
  });
  const head = `<div class="ctx-row ctx-hd"><span></span><div class="ctx-rul ctx-sc">${[0, 250, 500, 1000, 1500].map(v => `<span style="left:${v / RMAX * 100}%">${v ? nf0.format(v) : 0}</span>`).join('')}<span class="u">m</span></div><span class="n">≤ 500 m</span><span class="n">≤ 1 km</span><span class="n" title="% dos prédios com venda do mesmo distrito para os quais o equipamento mais próximo fica mais longe">mais perto que</span></div>`;
  const intro = `<p class="sub">Distância <b>em linha reta</b> a partir ${pt.exato ? 'do ponto interior do lote' : '<b>da coordenada do empreendimento (aproximada: não há lote com venda ligado)</b>'} · a pé costuma dar 1,2–1,4× · raio de 1,5 km. ` +
    `Pontos = até 20 mais próximos; rótulo = o mais próximo; tique cinza = mediana dos prédios com venda do distrito${cd ? ' (' + esc(R.dname(cd)) + ')' : ''}.</p>`;
  const foot = `<p class="note ctx-src">Fontes: GeoSampa (CC BY-SA 4.0), camadas de ${DATE_GS} · OpenStreetMap (ODbL, ${DATE_GS}; <b>cobertura desigual</b>, menor na periferia: ausência no OSM não é ausência real) · CNES 2026-08 (leitos) · INEP IDEB 2023 (rede pública) · estações em obra: lista manual a validar com Metrô/STM.</p>`;
  return intro + `<div class="ctx-grid">${head}${html}</div>` + zonaHtml(M, lote, lo, p, zp, pt) + entornoHtml(M, lote, lo, cd, pt) + foot;
}
function zonaHtml(M, lote, lo, p, zp, pt) {
  const link = `<a class="ctx-a" href="https://geosampa.prefeitura.sp.gov.br/PaginasPublicas/_SBC.aspx" target="_blank" rel="noopener">GeoSampa ↗</a>`;
  const hasLot = lote && lo != null;
  const zi = hasLot ? lote.z[lo] : zp ? zp.z : -1, za = hasLot ? lote.za[lo] : zp && zp.a, zo = hasLot ? lote.ou[lo] : zp && zp.o >= 0 ? zp.o : null;
  const tit = hasLot ? 'Zoneamento do lote' : `Zoneamento no ponto ${pt && pt.exato ? 'do lote' : 'do empreendimento (aproximado)'}`;
  const z = M.zonas[zi];
  if (!z) return `<div class="ctx-zona"><h4>${tit}</h4><p class="sub">— (ponto fora de perímetro de zona: praça, canteiro ou via) · ${link}</p></div>`;
  lote = {za: {0: za}, ou: {0: zo}}; lo = 0;
  const ca = v => v == null ? '—' : nf1.format(v).replace(',0', '');
  const ativ = /^ZE(U|M)P/.test(z.z) ? (lote.za[lo] ? ' · eixo previsto <b>ativado por decreto</b> (vale como ZEU/ZEM)' : ' · eixo previsto <b>não ativado</b>') : '';
  const ou = lote.ou[lo] != null ? ` · Operação Urbana ${esc(M.ouc[lote.ou[lo]] || '')}` : '';
  return `<div class="ctx-zona"><h4>${tit}</h4><div class="ctx-kv">` +
    `<span class="ctx-z">${esc(z.z)}</span><span><b>${esc(z.nome)}</b> · ${esc(M.g7[z.g7] || z.grupo)}${ativ}${ou}</span></div>` +
    `<div class="ctx-kpis"><div><span>CA básico</span><b>${ca(z.ca_bas)}</b></div><div><span>CA máximo</span><b>${ca(z.ca_max)}</b></div><div><span>Gabarito</span><b>${z.livre ? 'sem limite' : z.gab != null ? nf0.format(z.gab) + ' m' : '—'}</b></div>` +
    `<div><span>Taxa de ocupação</span><b>${z.to && z.to[0] != null ? nf0.format(z.to[0] * 100) + '%' : '—'}</b></div></div>` +
    `<p class="note">Zona pelo ponto interior do lote (lote atravessado por duas zonas recebe uma). Perímetro: Lei ${esc(z.lei)} (GeoSampa, ${esc(String(z.dt || '').split('-').reverse().join('/'))}); parâmetros: Quadro 3 da Lei 16.402/2016 na redação da 18.081/2024${z.nota ? ' · nota: ' + esc(z.nota) : ''}. ${link}</p></div>`;
}
function entornoHtml(M, lote, lo, cd, pt) {
  const items = [];
  if (lote && lo != null) {
    const rk = lote.rk[lo] || 0, ip = lote.ip[lo], rg = lote.rg[lo] || 0;
    items.push(['Inundação (mancha TR 25 anos)', rk & 1 ? `<b>ponto do lote dentro da mancha</b>${ip != null ? ` · profundidade máx. modelada na célula: ${nf1.format(ip / 10)} m` : ''} <span class="muted">(modelagem GeoSampa para chuva de retorno de 25 anos; a mancha segue ruas e calhas de córregos: confira no mapa, camada Riscos)</span>` : 'fora da mancha']);
    items.push(['Risco geológico (encosta)', rk & 2 ? `<b>dentro de setor mapeado</b>${rg ? ' · ' + (rg < 9 ? 'grau R' + rg : 'área encerrada/sem grau') : ''}` : 'fora de setor mapeado']);
    items.push(['Risco hidrológico (alagamento)', rk & 4 ? '<b>dentro de setor mapeado</b>' : 'fora de setor mapeado']);
    const rb = lote.rb[lo], pr = pctAbove(lote.q.rb, rb);
    items.push(['Roubos registrados a 500 m (2025)', rb == null ? '—' : `${nf0.format(rb)} BOs${pr != null ? ` · mais que em ${pr}% dos prédios do distrito` : ''} <span class="muted">(exposição, não taxa; subnotificação)</span>`]);
    const va = lote.va[lo], pv = pctAbove(lote.q.va, va != null ? va * 100 : null);
    items.push(['Varejo a 500 m (IPTU 2026)', va == null ? '—' : `${fM2k(va * 100)} de lojas${pv != null ? ` · mais que em ${pv}% dos prédios do distrito` : ''}`]);
    const cc = lote.cc[lo], cp = lote.cp[lo];
    const reg = [cc != null && C.com ? `${esc(COM_T[C.com.f[cc].t])}: ${esc(C.com.f[cc].n)}` : null, cp != null && C.com ? `polo ${esc(C.com.f[cp].n.replace(/^Polo /, ''))}${C.com.f[cp].p ? ' (' + esc(C.com.f[cp].p) + ')' : ''}` : null].filter(Boolean);
    items.push(['Região comercial', reg.length ? reg.join(' · ') : 'fora de corredor e polo']);
    const ia = lote.ia[lo], ifn = lote.if[lo];
    items.push(['Melhor IDEB a 1 km (rede pública, 2023)', ia == null && ifn == null ? '— (sem escola com IDEB a 1 km)' : `anos iniciais ${ia != null ? nf1.format(ia / 10) : '—'} · anos finais ${ifn != null ? nf1.format(ifn / 10) : '—'}`]);
  } else items.push(['Riscos, roubos, varejo e IDEB', `— (medidos só para lotes com venda${pt.exato ? '' : '; aqui só há a coordenada aproximada'})`]);
  return `<div class="ctx-zona"><h4>Riscos e entorno</h4><div class="ctx-list">${items.map(([k, v]) => `<div><span>${esc(k)}</span><span>${v}</span></div>`).join('')}</div></div>`;
}
const perto = view => ({id: 'perto', title: 'O que tem perto', order: 40,
  sub: 'Transporte, escolas, saúde, abastecimento, lazer, serviços públicos e zoneamento do lote. Medidas em linha reta; fontes oficiais primeiro, OSM como complemento.',
  render(el, ctx) { renderPerto(el, ctx, view); }});
R.registerSection('lancamento', perto('lancamento'));   // no Prédio saiu (pedido de 28/09): o mapa de comparáveis já mostra o entorno

/* ════════ seção do Distrito: acesso a trilho e equipamentos ═════ */
R.registerSection('distrito', {id: 'contexto', title: 'Contexto urbano do distrito', order: 60,
  sub: 'Lotes com venda perto de trilho (hoje e com as obras), zoneamento e equipamentos por km². Distâncias em linha reta.',
  render(el, ctx) {
    const cd = ctx.cd, tok = (el._ctxTok = (el._ctxTok || 0) + 1);
    el.innerHTML = '<div class="loading">Carregando…</div>';
    meta().then(M => {
      if (el._ctxTok !== tok) return;
      const d = M.distritos[cd]; if (!d) { el.innerHTML = '<p class="sub">—</p>'; return; }
      const sp = Object.values(M.distritos), med = a => R.med(a.filter(v => v != null));
      const dens = k => d.n[k] != null && d.km2 ? d.n[k] / d.km2 : null, cityDens = k => med(sp.map(x => x.n[k] != null && x.km2 ? x.n[k] / x.km2 : null));
      const kp = (l, v, s) => R.kpi(l, v, s);
      const pc = v => v == null ? '—' : nf0.format(v) + '%';
      el.innerHTML = `<div class="kpis">${[
        kp('Lotes a ≤ 500 m de estação', pc(d.tr500), `≤ 1 km: ${pc(d.tr1k)} · cidade (mediana dos distritos) ${pc(med(sp.map(x => x.tr1k)))}`),
        kp('Distância mediana ao trilho', fm(d.med_tr), 'estação de metrô/trem existente'),
        kp('Com obra a ≤ 1 km', pc(d.obra1k), 'estação em obra (lista a validar)'),
        kp('Lotes em eixo · em ZER', `${pc(d.eixo)} · ${pc(d.zer)}`, 'ZEU/ZEM/ZEUP/ZEMP · ZER'),
        kp('Na mancha de inundação', pc(d.inund), 'TR 25 anos (GeoSampa)'),
        kp('Roubos a 500 m (mediana)', d.roubo500 != null ? nf0.format(d.roubo500) + ' BOs' : '—', 'SSP 2025 · exposição, subnotificação'),
      ].join('')}</div>` +
        `<table class="t ctx-dt"><thead><tr><th>Equipamento</th><th class="n">no distrito</th><th class="n">por km²</th><th class="n">cidade (mediana por km²)</th></tr></thead><tbody>` +
        M.cats.filter(c => !['parque'].includes(c.k)).map(c => `<tr><td>${icoHtml(c.k, c.osm, c.k === 'cemit')} ${esc(c.l)}${c.osm ? ' <small class="lic">OSM</small>' : ''}</td><td class="n">${d.n[c.k] != null ? nf0.format(d.n[c.k]) : '0'}</td><td class="n">${dens(c.k) != null ? nf1.format(dens(c.k)) : '—'}</td><td class="n">${cityDens(c.k) != null ? nf1.format(cityDens(c.k)) : '—'}</td></tr>`).join('') +
        `</tbody></table><p class="note">Área do distrito ${d.km2 ? nf1.format(d.km2) + ' km²' : '—'} · ${nf0.format(d.lotes)} lotes com venda. Contagens do OSM são índice relativo (cobertura desigual entre regiões); fontes oficiais: GeoSampa (${DATE_GS}), CNES 2026-08.</p>`;
    }).catch(() => { if (el._ctxTok === tok) el.innerHTML = '<p class="sub">Contexto indisponível: abra pelo serve.py.</p>'; });
  }});

/* ════════ mapas de entorno (Prédio · comparáveis, Lançamento): ícones de equipamentos e estações em volta ═════
   Mesmos ícones da camada da Cidade; colisão ligada (o MapLibre esconde o que se sobrepõe; aproximar revela o resto);
   restaurantes e templos (só OSM, muito densos) ficam de fora para não poluir. */
const DEC_OFF = new Set(['alim', 'templo']);
const DEC_PRI = {ubs: 2, hosp: 2, esc_pub: 3, esc_priv: 3, infantil: 4, super: 3, feira: 4, parque: 3, praca: 6, univ: 4, shop: 4, farm: 5, acad: 6, esporte: 6, cult: 5, dp: 5, pol: 5, pub: 6, cemit: 8};
function decorPois(H, ctx) {
  const map = H.map; if (!ctx || !ctx.center) return;
  H.decor = H.decor || {};
  if (!H.decor.ctx) H.decor.ctx = {hits: () => ['app-dec-poi', 'app-dec-st'], tip: f => decTip(f)};
  const c0 = ctx.center, rM = Math.max(600, (ctx.radius || 1) * 1000 * 1.25);
  const key = c0.join(',') + '|' + rM + '|' + R.mode();
  if (!map.getSource('app-dec-poi')) H._decKey = null;   // estilo recarregado (tema/mapa base): fontes novas, vazias
  R.upsertSrc(map, 'app-dec-poi', R.EMPTY_FC, true); R.upsertSrc(map, 'app-dec-st', R.EMPTY_FC, true);
  const sz = ['interpolate', ['linear'], ['zoom'], 12.5, 0.5, 14.5, 0.72, 16.5, 0.9, 18, 1];
  // por baixo das camadas do lançamento (ctx.below): os selos de logo têm prioridade na colisão sobre os ícones
  R.addLayerOnce(map, {id: 'app-dec-poi', type: 'symbol', source: 'app-dec-poi', layout: {'icon-image': ['get', 'im'], 'icon-size': sz, 'icon-allow-overlap': false, 'icon-padding': 1, 'symbol-sort-key': ['get', 'o']}}, ctx.below);
  R.addLayerOnce(map, {id: 'app-dec-st', type: 'symbol', source: 'app-dec-st', layout: {'icon-image': ['get', 'im'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.5, 14.5, 0.7, 16.5, 0.92, 18, 1.08], 'icon-allow-overlap': true,
    'text-field': ['step', ['zoom'], '', 14, ['get', 'nm']], 'text-font': styleFont(map), 'text-size': 10.5, 'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-optional': true, 'text-max-width': 8}}, ctx.below);
  const h = halo(); Object.keys(h).forEach(k => map.setPaintProperty('app-dec-st', k, h[k]));
  if (H._decKey === key) return;
  meta().then(M => {
    putImages(map);
    const cds = bbHit(M.pbb, boxAround(c0, rM));
    return Promise.all([C.tr ? null : get('transporte.json').then(t => { C.tr = t; }), C.parques ? null : get('parques.json').then(j => { C.parques = j; }).catch(() => null)]
      .concat(cds.map(cd => C.poi[cd] ? null : get(`poi/${cd}.json`).then(j => poiDecode(cd, j)).catch(() => null)))).then(() => {
      if (!map.getSource('app-dec-poi')) return;
      const pf = [];
      cds.forEach(cd => (C.poi[cd] || []).forEach((q, i) => { if (DEC_OFF.has(q.c.k)) return; const d = dm(c0, q.p); if (d > rM) return;
        pf.push({type: 'Feature', geometry: {type: 'Point', coordinates: q.p}, properties: {cd, i, d, im: `ctx-i-${q.c.k}-${q.s === 2 ? 's' : 'c'}`, o: (DEC_PRI[q.c.k] || 7) * 10000 + Math.round(d)}}); }));
      if (C.parques) C.parques.p.forEach((q, i) => { const d = dm(c0, q.c); if (d <= rM) pf.push({type: 'Feature', geometry: {type: 'Point', coordinates: q.c}, properties: {cd: '_pq', i, d, im: 'ctx-i-parque-c', o: 30000 + Math.round(d)}}); });
      const sf = C.tr ? C.tr.st.map((s, i) => ({s, i, d: dm(c0, [s[5], s[6]])})).filter(x => x.d <= rM * 1.2 && x.s[4] !== 'planejada')
        .map(x => ({type: 'Feature', geometry: {type: 'Point', coordinates: [x.s[5], x.s[6]]}, properties: {st: x.i, d: x.d, nm: x.s[0], im: x.s[4] === 'existente' ? 'ctx-i-trem' : 'ctx-i-trem-o'}})) : [];
      map.getSource('app-dec-poi').setData({type: 'FeatureCollection', features: pf});
      map.getSource('app-dec-st').setData({type: 'FeatureCollection', features: sf});
      H._decKey = key;
    });
  }).catch(e => ctxErr('equipamentos no entorno', e));
}
function decTip(f) {
  const p = f.properties, dist = p.d != null ? ` · ${fm(p.d)} do centro` : '';
  if (f.layer.id === 'app-dec-st') { const s = C.tr && C.tr.st[p.st]; if (!s) return null; return R.tip(s[0], [['Linha', lineLab(s[1], s[2]) + ' · ' + s[3]], ['Status', TR_ST[s[4]] || s[4]]], `GeoSampa, ${DATE_GS}${dist}`); }
  if (p.cd === '_pq') { const q = C.parques && C.parques.p[p.i]; return q ? R.tip(q.n, [['Categoria', q.t || 'parque'], ['Área', q.a ? nf1.format(q.a / 1e4) + ' ha' : '—']], `GeoSampa${dist}`) : null; }
  const q = (C.poi[p.cd] || [])[p.i]; if (!q) return null;
  const rows = [['Categoria', q.c.l]]; if (q.a) rows.push(['Detalhe', q.a]); if (q.b) rows.push(['IDEB 2023', q.b]);
  return R.tip(q.n || '(sem nome na fonte)', rows, srcLab(q.s) + dist);
}
R.registerMapDecor(decorPois);
/* legenda curta dos ícones (para os mapas de entorno) */
R.ctxIconLegend = () => ['esc_pub', 'infantil', 'ubs', 'hosp', 'super', 'feira', 'parque', 'acad', 'cult', 'dp', 'pub'].map(k => icoHtml(k)).join('') + icoHtml('trem', false, false).replace('ctx-ic', 'ctx-ic solid');

/* API para outros módulos: contexto de um ponto (Promise) */
R.contexto = {meta, lote: lotePromise, perto: (el, ctx) => renderPerto(el, ctx, 'lancamento')};
