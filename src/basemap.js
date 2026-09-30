/* ════════ MAPA PADRÃO · porte do BaseMap do dashboard ══════════════ */
/* Mesmo visual e comportamento de fii_quant/dashboard/src/components/map (config.ts + BaseMap.tsx):
   mapa base CARTO minimalista (MINIMAL_HIDE, vias a 55%), prédios 3D neutros com altura real —
   LiDAR 2020 dentro da capital SP (geo_app :5113, via serve.py) e OpenStreetMap fora dela, cortados
   pelo mesmo limite oficial —, rampa neutra PREDIO_RAMPA, zoom máx. 18, controles compactos
   (Prédios · Lotes | 3D · mapa base · ⤢). Sem React: um objeto por mapa (createBaseMap). */
const BMC = {
  BASEMAPS: {
    escuro: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    claro: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    ruas: 'https://tiles.openfreemap.org/styles/liberty',
    satelite: {version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {esri: {type: 'raster', tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']}},
      layers: [{id: 'esri', type: 'raster', source: 'esri'}]},
  },
  LABEL: {auto: 'Auto', escuro: 'Escuro', claro: 'Claro', ruas: 'Ruas', satelite: 'Satélite'},
  BRASIL_BOUNDS: [[-80, -38], [-28, 8]],
  MAX_ZOOM: 18,   // acima disto os contornos do LiDAR (~0,7 m) e os tiles viram "blocos"
  MINIMAL_HIDE: /poi|housenumber|shield|oneway|transit|aerialway|ferry|airport|aeroway|railway|roadname_(minor|sec)|road_label|highway-name-(minor|path)|place_(hamlet|villages|isolated)|waterway_label|watername_lake_line|mountain_peak/i,
  ZOOM: {prediosMin: 12, osmMin: 13, lotesMin: 16, tresDMin: 13.5},
  REQ_SPAN: {predios: 0.3, lotes: 0.019},   // maior lado do bbox por pedido (tetos do backend)
  ENDPOINTS: {predios: '/api/geo/geosampa/predios_visao', lotes: '/api/geo/geosampa/lotes'},
  OSM_VECTOR: {url: 'https://tiles.openfreemap.org/planet', sourceLayer: 'building'},
  RAMPA: {
    escuro: [0, '#2a2e35', 15, '#353b45', 40, '#454e5c', 80, '#5a6679', 150, '#76849b'],
    claro: [0, '#e6e7ea', 15, '#dcdfe4', 40, '#cdd2da', 80, '#b8bfcb', 150, '#9ea8b8'],
  },
  LOTE: '#8ab8ff',
  // servida pelo serve.py: /api/geo na mesma origem; aberta via file://: o serve.py em 8765 (com CORS)
  GEO: /^https?:$/.test(location.protocol) ? '' : 'http://127.0.0.1:8765',
};
const EMPTY_FC = {type: 'FeatureCollection', features: []};
/* site estático (spin-off público, assemble.py --flag publico): não há /api/geo. Os prédios 3D vêm do OpenStreetMap
   (OpenFreeMap) também dentro da capital e o botão "Lotes" (lotes neutros do GeoSampa) só aparece se houver um
   PMTiles configurado em BMC.LOTES_PMTILES (ainda não gerado: decisão pendente). */
const FLAGS = window.RADAR_FLAGS || {};
const PUBLICO = !!FLAGS.publico;
const SP_CAP = D.geo.sp_capital;   // limite oficial do município (o mesmo arquivo do BaseMap)
const SP_BB = (() => { const r = SP_CAP.coordinates[0]; const xs = r.map(c => c[0]), ys = r.map(c => c[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })();
const DIST_SP = ['distance', SP_CAP];
function pipRing(x, y, ring) { let d = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; }
function tocaSP(map) {
  const b = map.getBounds();
  if (b.getEast() < SP_BB[0] || b.getWest() > SP_BB[2] || b.getNorth() < SP_BB[1] || b.getSouth() > SP_BB[3]) return false;
  const c = map.getCenter();
  return [[c.lng, c.lat], [b.getWest(), b.getSouth()], [b.getWest(), b.getNorth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()]].some(([x, y]) => pipRing(x, y, SP_CAP.coordinates[0]));
}
function reqBbox(map, span) {
  const b = map.getBounds(), c = map.getCenter();
  const hw = Math.min((b.getEast() - b.getWest()) / 2, span / 2), hh = Math.min((b.getNorth() - b.getSouth()) / 2, span / 2);
  const clipped = hw < (b.getEast() - b.getWest()) / 2 || hh < (b.getNorth() - b.getSouth()) / 2;
  return {bbox: [c.lng - hw, c.lat - hh, c.lng + hw, c.lat + hh].map(v => v.toFixed(5)).join(','), clipped};
}
const rampa = campo => ['interpolate', ['linear'], campo, ...(isDark() ? BMC.RAMPA.escuro : BMC.RAMPA.claro)];
const fmtN = (v, d = 0) => typeof v === 'number' ? v.toLocaleString('pt-BR', {maximumFractionDigits: d}) : '—';
const popupPredioLidar = p => `<div class="bm-pop"><strong>Prédio (LiDAR 2020)</strong><br>Altura do prédio: ${fmtN(p.altura_predio_m, 1)} m<br>Este nível: ${fmtN(p.altura_m, 1)} m · ${fmtN(p.area_m2)} m² (nível ${Number(p.nivel) + 1})<br><span class="bm-mut">fonte: GeoSampa MDS/MDT 2020, laser 1:1000 · folha ${esc(p.folha)}</span></div>`;
const popupPredioOsm = p => `<div class="bm-pop"><strong>Prédio (OpenStreetMap)</strong><br>Altura: ${typeof p.render_height === 'number' ? fmtN(p.render_height, 1) + ' m' : 'não informada'}<br><span class="bm-mut">fonte: OpenStreetMap (${PUBLICO ? 'altura cadastrada por voluntários, pode faltar ou ser estimada; sem LiDAR neste site' : 'fora da capital SP; altura cadastrada por voluntários, pode faltar ou ser estimada'})</span></div>`;
function rafThrottle(fn) { let raf = 0, last; return (...a) => { last = a; if (!raf) raf = requestAnimationFrame(() => { raf = 0; fn(...last); }); }; }

const BMAPS = [];
/* tela cheia do navegador (F11 / API Fullscreen): o canvas precisa ser redimensionado (30/09) */
document.addEventListener('fullscreenchange', () => BMAPS.forEach(H => H.map && H.map.resize()));
function createBaseMap(host, opts) {
  const o = Object.assign({layers: {predios: 'on', lotes: 'off'}, basemap: 'auto', pitch: 0, onStyle: null}, opts);
  o.layers = Object.assign({}, o.layers);
  if (PUBLICO && o.layers.lotes !== 'hidden' && !BMC.LOTES_PMTILES) o.layers.lotes = 'hidden';
  host.classList.add('bm-host');
  host.innerHTML = '<div class="bm-canvas" style="position:absolute;inset:0"></div><div class="bm-ctrls"></div><div class="bm-hint" aria-live="polite"></div>';
  const cv = host.querySelector('.bm-canvas'), ctrls = host.querySelector('.bm-ctrls'), hintEl = host.querySelector('.bm-hint');
  const H = {host, basemap: o.basemap, ready: false, sized: false, pending: null, expanded: false, msg: {}, hl: new Set(),
    on: {predios: o.layers.predios === 'on', lotes: o.layers.lotes === 'on'}, predData: EMPTY_FC, lotesData: EMPTY_FC};
  const styleFor = () => BMC.BASEMAPS[H.basemap === 'auto' ? (isDark() ? 'escuro' : 'claro') : H.basemap];
  let map;
  try {
    map = new maplibregl.Map({container: cv, style: styleFor(), center: [-46.66, -23.57], zoom: 10.5, pitch: o.pitch,
      minZoom: 2.5, maxZoom: BMC.MAX_ZOOM, maxBounds: BMC.BRASIL_BOUNDS, attributionControl: {compact: true},
      pixelRatio: Math.max(window.devicePixelRatio || 1, 2)});   // nítido também em tela 1×
  } catch (e) {
    console.warn('BaseMap: WebGL indisponível neste navegador — mapa desativado.');
    host.insertAdjacentHTML('beforeend', '<div class="bm-nogl">Mapa indisponível: o navegador não oferece WebGL (aceleração gráfica desligada ou navegador sem GPU).</div>');
    return null;
  }
  H.map = map;
  BMAPS.push(H);
  map.addControl(new maplibregl.NavigationControl({visualizePitch: true}), 'bottom-right');   // zoom e bússola no canto inferior direito (o superior direito é do painel de camadas)
  map.addControl(new maplibregl.ScaleControl({unit: 'metric', maxWidth: 80}), 'bottom-left');

  // controles compactos: [Prédios · Lotes] [3D · mapa base · ⤢]
  const chip = (label, title, dot) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bm-chip'; b.title = title; b.innerHTML = (dot ? `<i style="--dc:${dot}"></i>` : '') + label; return b; };
  const g1 = document.createElement('div'), g2 = document.createElement('div');
  g1.className = g2.className = 'bm-grp';
  const btnPred = o.layers.predios !== 'hidden' ? chip('Prédios', PUBLICO ? 'Prédios 3D do OpenStreetMap (alturas cadastradas por voluntários; podem faltar). O LiDAR da Prefeitura só existe na versão interna.'
    : 'Prédios 3D com altura real. Capital SP: LiDAR 2020 da Prefeitura (GeoSampa). Fora da capital: OpenStreetMap.', '#8ab8ff') : null;
  const btnLot = o.layers.lotes !== 'hidden' ? chip('Lotes', 'Lotes fiscais (GeoSampa, só capital SP, zoom ≥ 16)', BMC.LOTE) : null;
  [btnPred, btnLot].forEach(b => b && g1.appendChild(b));
  const btn3d = chip('3D', 'Inclinar o mapa com os prédios em 3D');
  const sel = document.createElement('select');
  sel.className = 'bm-sel'; sel.title = 'Mapa base'; sel.setAttribute('aria-label', 'Mapa base');
  sel.innerHTML = Object.entries(BMC.LABEL).map(([k, v]) => `<option value="${k}"${k === H.basemap ? ' selected' : ''}>${v}</option>`).join('');
  const ICON_EXP = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7 1h4v4M5 11H1V7M11 1 7 5M1 11l4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_X = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const btnExp = chip(ICON_EXP, 'Expandir o mapa');
  btnExp.setAttribute('aria-label', 'Expandir mapa');
  [btn3d, sel, btnExp].forEach(b => g2.appendChild(b));
  if (g1.children.length) ctrls.appendChild(g1);
  ctrls.appendChild(g2);
  function syncCtrls() {
    if (btnPred) btnPred.setAttribute('aria-pressed', String(H.on.predios));
    if (btnLot) btnLot.setAttribute('aria-pressed', String(H.on.lotes));
    btn3d.setAttribute('aria-pressed', String(map.getPitch() > 5));
    btnExp.setAttribute('aria-pressed', String(H.expanded));
    btnExp.innerHTML = H.expanded ? ICON_X : ICON_EXP;
    btnExp.title = H.expanded ? 'Fechar (Esc)' : 'Expandir o mapa';
    hintEl.textContent = (H.on.predios && H.msg.predios) || (H.on.lotes && H.msg.lotes) || '';
  }
  const setMsg = (k, m) => { H.msg[k] = m; syncCtrls(); };

  const vis = (id, v) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'); };
  function applyToggles() {
    if (!H.ready) return;
    vis('bm-pred-3d', H.on.predios); vis('bm-osm-3d', H.on.predios);
    vis('bm-lotes-fill', H.on.lotes); vis('bm-lotes-line', H.on.lotes);
    // com "Prédios" ligado, os prédios do próprio mapa base somem (só a nossa fonte aparece)
    for (const L of map.getStyle().layers || []) if (/building/i.test(L.id) && !/^(bm|app)-/.test(L.id)) vis(L.id, !H.on.predios);
    map.setPaintProperty('bm-pred-3d', 'fill-extrusion-color', rampa(['coalesce', ['get', 'altura_m'], 3]));
    map.setPaintProperty('bm-osm-3d', 'fill-extrusion-color', rampa(['coalesce', ['get', 'render_height'], 3]));
    map.setLight({anchor: 'viewport', position: [1.3, 210, 35], intensity: isDark() ? 0.45 : 0.32, color: '#ffffff'});
    syncCtrls();
  }
  function addBase() {
    if (!map.getSource('bm-lotes')) {
      map.addSource('bm-lotes', {type: 'geojson', data: H.lotesData});
      map.addLayer({id: 'bm-lotes-fill', type: 'fill', source: 'bm-lotes', paint: {'fill-color': BMC.LOTE, 'fill-opacity': 0.06}});
      map.addLayer({id: 'bm-lotes-line', type: 'line', source: 'bm-lotes', paint: {'line-color': BMC.LOTE, 'line-width': 0.7, 'line-opacity': 0.8}});
    }
    if (!map.getSource('bm-pred')) {   // LiDAR 2020 dentro da capital (sem os prédios Siila destacados: hl = 1)
      map.addSource('bm-pred', {type: 'geojson', data: H.predData});
      map.addLayer({id: 'bm-pred-3d', type: 'fill-extrusion', source: 'bm-pred',
        filter: ['all', ['!=', ['get', 'fonte'], 'lote_aproximacao'], ['!=', ['get', 'hl'], 1], ['==', DIST_SP, 0]],
        paint: {'fill-extrusion-height': ['coalesce', ['get', 'altura_m'], 3], 'fill-extrusion-base': 0,
          'fill-extrusion-color': rampa(['coalesce', ['get', 'altura_m'], 3]), 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true}});
    }
    if (!map.getSource('bm-osm')) {    // …e OpenStreetMap fora dela (vetorial, OpenFreeMap)
      map.addSource('bm-osm', {type: 'vector', url: BMC.OSM_VECTOR.url});
      map.addLayer({id: 'bm-osm-3d', type: 'fill-extrusion', source: 'bm-osm', 'source-layer': BMC.OSM_VECTOR.sourceLayer, minzoom: BMC.ZOOM.osmMin,
        filter: PUBLICO ? ['!=', ['get', 'hide_3d'], true] : ['all', ['!=', ['get', 'hide_3d'], true], ['>', DIST_SP, 0]],   // público: OSM também na capital
        paint: {'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-color': rampa(['coalesce', ['get', 'render_height'], 3]), 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true}});
    }
  }
  map.on('style.load', () => {
    H.ready = true;
    for (const L of map.getStyle().layers || []) {   // mapa base minimalista
      if (/^(bm|app)-/.test(L.id)) continue;
      if (BMC.MINIMAL_HIDE.test(L.id)) map.setLayoutProperty(L.id, 'visibility', 'none');
      else if (L.type === 'line' && /road|highway|bridge|tunnel|street|path/i.test(L.id)) map.setPaintProperty(L.id, 'line-opacity', 0.55);
    }
    addBase();
    if (o.onStyle) o.onStyle(H);
    applyToggles();
    load();
  });
  map.once('load', () => { const a = cv.querySelector('.maplibregl-compact-show'); if (a) a.classList.remove('maplibregl-compact-show'); });
  map.on('pitchend', syncCtrls);

  // camadas do backend por viewport (prédios LiDAR, lotes), com debounce — como no BaseMap
  let timer = 0; const seq = {};
  const remotas = [
    {key: 'predios', src: 'bm-pred', min: BMC.ZOOM.prediosMin, url: BMC.ENDPOINTS.predios, span: BMC.REQ_SPAN.predios},
    {key: 'lotes', src: 'bm-lotes', min: BMC.ZOOM.lotesMin, url: BMC.ENDPOINTS.lotes, span: BMC.REQ_SPAN.lotes},
  ];
  const markHl = d => { for (const f of d.features || []) if (f.properties) f.properties.hl = H.hl.has(f.properties.predio_id) ? 1 : 0; };
  function load() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!H.ready) return;
      const z = map.getZoom();
      for (const L of remotas) {
        const src = map.getSource(L.src);
        if (!H.on[L.key] || !src) continue;
        if (PUBLICO) { setMsg(L.key, null); continue; }   // sem /api/geo no site estático
        const put = d => { if (L.key === 'predios') { markHl(d); H.predData = d; } else H.lotesData = d; src.setData(d); };
        if (!tocaSP(map)) { put(EMPTY_FC); setMsg(L.key, null); continue; }   // fora da capital: OSM (prédios) / nada (lotes)
        if (z < L.min) { put(EMPTY_FC); setMsg(L.key, `Aproxime (zoom ≥ ${L.min}) para ver ${L.key === 'predios' ? 'prédios' : 'lotes'}`); continue; }
        const {bbox, clipped} = reqBbox(map, L.span);
        const my = seq[L.src] = (seq[L.src] || 0) + 1;
        setMsg(L.key, 'Carregando…');
        fetch(BMC.GEO + L.url + '?bbox=' + bbox + (L.key === 'predios' ? '&zoom=' + z.toFixed(1) : ''))
          .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(j => Promise.reject(j.detail || 'HTTP ' + r.status)))
          .then(data => {
            if (my !== seq[L.src]) return;
            put(data);
            const hmin = data.meta && data.meta.altura_min_m;
            setMsg(L.key, !data.features.length ? (L.key === 'predios' ? 'Sem LiDAR 2020 processado nesta área' : 'Sem lotes GeoSampa aqui')
              : L.key === 'predios' && hmin ? `prédios ≥ ${hmin} m (aproxime para todos)` : clipped ? 'só o centro da tela (aproxime para cobrir tudo)' : null);
          })
          .catch(err => {
            if (my !== seq[L.src]) return;
            setMsg(L.key, typeof err === 'string' ? 'GeoSampa: ' + err
              : L.key === 'predios' ? 'Prédios LiDAR indisponíveis: abra pela URL do serve.py (ver README)' : 'GeoSampa indisponível');
          });
      }
    }, 250);
  }
  map.on('moveend', load);

  const setStyle = () => { H.ready = false; map.setStyle(styleFor(), {diff: false}); };
  if (btnPred) btnPred.addEventListener('click', () => { H.on.predios = !H.on.predios; applyToggles(); load(); });
  if (btnLot) btnLot.addEventListener('click', () => { H.on.lotes = !H.on.lotes; applyToggles(); load(); });
  btn3d.addEventListener('click', () => {
    if (map.getPitch() > 5) map.easeTo({pitch: 0, bearing: 0});
    else {
      if (btnPred && !H.on.predios) { H.on.predios = true; applyToggles(); }
      map.easeTo({pitch: 60, zoom: Math.max(map.getZoom(), BMC.ZOOM.tresDMin)});
    }
  });
  sel.addEventListener('change', () => { H.basemap = sel.value; setStyle(); });
  function expand(v) {
    H.expanded = v;
    host.classList.toggle('bm-expanded', v);
    if (v) { H.bd = document.createElement('div'); H.bd.className = 'bm-backdrop'; H.bd.addEventListener('click', () => expand(false)); document.body.appendChild(H.bd); }
    else if (H.bd) { H.bd.remove(); H.bd = null; }
    // o ResizeObserver cobre a maioria dos casos, mas o canvas fica com a largura antiga até o próximo frame: força o resize (30/09)
    const rs = () => map.resize(); requestAnimationFrame(rs); setTimeout(rs, 80); setTimeout(rs, 320);
    syncCtrls();
  }
  btnExp.addEventListener('click', () => expand(!H.expanded));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && H.expanded) expand(false); });

  // enquadramento só com tamanho real (mapa em aba escondida não abre "super-ampliado")
  function flush() {
    if (!H.pending || !H.sized) return;
    const r = H.pending; H.pending = null;
    const cam = {pitch: r.pitch != null ? r.pitch : map.getPitch(), bearing: r.bearing != null ? r.bearing : map.getBearing()};
    if (r.bounds) map.fitBounds(r.bounds, Object.assign({padding: r.padding != null ? r.padding : 30, maxZoom: r.maxZoom || 16, duration: r.duration || 0}, cam));
    else map.jumpTo(Object.assign({center: r.center, zoom: r.zoom}, cam));
  }
  new ResizeObserver(() => { map.resize(); H.sized = cv.clientWidth > 50 && cv.clientHeight > 50; flush(); }).observe(cv);

  H.fit = req => { H.pending = req; flush(); };
  H.setHighlight = pids => { H.hl = new Set(pids); markHl(H.predData); const s = H.ready && map.getSource('bm-pred'); if (s) s.setData(H.predData); };
  H.onTheme = () => { if (H.basemap === 'auto') setStyle(); else applyToggles(); };
  H.hit = (ids, pt) => { ids = ids.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none'); return ids.length ? map.queryRenderedFeatures(pt, {layers: ids}) : []; };
  syncCtrls();
  return H;
}
function firstSymbol(map) { const L = (map.getStyle().layers || []).find(l => l.type === 'symbol' && !/^(bm|app)-/.test(l.id)); return L ? L.id : undefined; }
function upsertSrc(map, id, data, once) { const s = map.getSource(id); if (s) { if (!once) s.setData(data); } else map.addSource(id, {type: 'geojson', data}); }
function addLayerOnce(map, spec, before) { if (!map.getLayer(spec.id)) map.addLayer(spec, before && map.getLayer(before) ? before : undefined); }
function visL(map, id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
function putImage(map, id, img) { if (map.hasImage(id)) map.updateImage(id, img); else map.addImage(id, img, {pixelRatio: 2}); }
function diamondImg(fill, stroke, lw) {
  const s = 40, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath(); g.moveTo(s / 2, 3); g.lineTo(s - 3, s / 2); g.lineTo(s / 2, s - 3); g.lineTo(3, s / 2); g.closePath();
  g.fillStyle = fill; g.fill(); g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = stroke; g.stroke();
  return g.getImageData(0, 0, s, s);
}
/* hover = tooltip (como o tooltip do ECharts); clique = navega. Prédio neutro: popup LiDAR/OSM do BaseMap. */
function wireMap(H, o) {
  const map = H.map;
  const pop = new maplibregl.Popup({closeButton: false, closeOnClick: false, maxWidth: '320px', className: 'bm-popup bm-hover', offset: 14});
  const clickPop = new maplibregl.Popup({closeButton: true, maxWidth: '320px', className: 'bm-popup'});
  map.on('mousemove', rafThrottle(e => {
    const f = H.hit(o.layers(), e.point)[0];
    const html = f ? o.tip(f) : o.hoverFallback ? o.hoverFallback(e) : null;
    map.getCanvas().style.cursor = html ? 'pointer' : '';
    if (html) pop.setLngLat(e.lngLat).setHTML(html).addTo(map); else pop.remove();
  }));
  map.getCanvas().addEventListener('mouseleave', () => { pop.remove(); map.getCanvas().style.cursor = ''; });
  map.on('movestart', () => pop.remove());
  map.on('click', e => {
    pop.remove();
    const f = H.hit(o.layers(), e.point)[0];
    if (f) { o.click(f); return; }
    const nb = map.getZoom() >= 14 ? H.hit(['bm-pred-3d', 'bm-osm-3d'], e.point)[0] : null;
    if (nb) { clickPop.setLngLat(e.lngLat).setHTML(nb.layer.id === 'bm-osm-3d' ? popupPredioOsm(nb.properties) : popupPredioLidar(nb.properties)).addTo(map); return; }
    if (o.clickFallback) o.clickFallback(e);
  });
}
