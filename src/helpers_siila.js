/* ── formatação ───────────────────────────────────────── */
const nf0 = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const nf1 = new Intl.NumberFormat('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const nf2 = new Intl.NumberFormat('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fInt = v => v == null ? '—' : nf0.format(v);
const fM2 = v => v == null ? '—' : (Math.abs(v) >= 1e6 ? nf2.format(v / 1e6) + ' mi m²' : Math.abs(v) >= 1e4 ? nf0.format(v / 1e3) + ' mil m²' : nf0.format(v) + ' m²');
const fM2s = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + fM2(Math.abs(v));
const fPct = v => v == null ? '—' : nf1.format(v) + '%';
const fPP = v => v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '±') + nf1.format(Math.abs(v)) + ' p.p.';
const fSPct = v => v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '±') + nf1.format(Math.abs(v)) + '%';
const fBRL = v => v == null ? '—' : 'R$ ' + nf1.format(v);
const fMonths = v => v == null ? '—' : v > 240 ? '> 240' : nf0.format(v);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const qt = (a, q) => { const v = a.filter(x => x != null).sort((x, y) => x - y); if (!v.length) return null; const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
/* ── tema / cores ─────────────────────────────────────── */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function isDark() { const t = document.documentElement.getAttribute('data-theme'); if (t) return t === 'dark'; return matchMedia('(prefers-color-scheme: dark)').matches; }
const RAMP = {
  light: {seq: ['#e6f0fc', '#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'],
    neg: ['#f0efec', '#cde2fb', '#86b6ef', '#3987e5', '#184f95'], pos: ['#f0efec', '#fbd9d7', '#f29c99', '#e34948', '#a82f2e']},
  dark: {seq: ['#1f2a38', '#173d6b', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
    neg: ['#383835', '#1d3a5e', '#1c5cab', '#3987e5', '#86b6ef'], pos: ['#383835', '#4d2726', '#8f3534', '#e34948', '#f29c99']},
};
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = a => '#' + a.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
function ramp(stops, t) { t = clamp(t, 0, 1); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i; const a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]); return rgb2hex(a.map((x, j) => x + (b[j] - x) * f)); }
const mode = () => isDark() ? 'dark' : 'light';
const seqColor = (v, lo, hi) => v == null ? css('--surface-3') : ramp(RAMP[mode()].seq, (v - lo) / (hi - lo));
/* diverging "bom para o proprietário": positivo = azul, negativo = vermelho */
const divColor = (good, lim) => good == null ? css('--surface-3') : good >= 0 ? ramp(RAMP[mode()].neg, good / lim) : ramp(RAMP[mode()].pos, -good / lim);
const gradCss = (stops) => `linear-gradient(90deg, ${stops.join(',')})`;
const divGradCss = () => { const M = RAMP[mode()]; return `linear-gradient(90deg, ${M.pos.slice().reverse().join(',')}, ${M.neg.slice(1).join(',')})`; };
const clsColor = c => c === 'A+' ? css('--s1') : c === 'A' ? css('--s2') : c === 'B' ? css('--s3') : css('--s-other');
const FONT = '"Hanken Grotesk", system-ui, sans-serif';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── echarts helpers ──────────────────────────────────── */
const CH = {};
const ro = new ResizeObserver(es => { for (const e of es) { const c = echarts.getInstanceByDom(e.target); if (c && e.contentRect.width > 0) c.resize(); } });
function chart(id) {
  const el = document.getElementById(id); if (!el) return null;
  let c = CH[id];
  if (c && !c.isDisposed() && c.getDom() !== el) c.dispose();   // o elemento foi recriado (innerHTML): nova instância
  if (c && c.isDisposed()) c = null;
  if (!c) { c = echarts.init(el, null, {renderer: 'canvas'}); CH[id] = c; ro.observe(el); }
  return c;
}
function base() {
  return {
    animation: !reduced, animationDuration: 350,
    textStyle: {fontFamily: FONT, color: css('--ink-2'), fontSize: 11},
    tooltip: {confine: true, backgroundColor: css('--surface'), borderColor: css('--border-strong'), borderWidth: 1, padding: [8, 10],
      textStyle: {color: css('--ink'), fontFamily: FONT, fontSize: 12}, extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.16);border-radius:7px;'},
  };
}
const ax = (o = {}) => Object.assign({axisLine: {lineStyle: {color: css('--axis')}}, axisTick: {show: false},
  axisLabel: {color: css('--muted'), fontSize: 10.5, fontFamily: FONT}, splitLine: {lineStyle: {color: css('--grid'), width: 1}},
  nameTextStyle: {color: css('--ink-2'), fontSize: 11, fontFamily: FONT}}, o);
const tip = (title, rows, foot) => `<div class="tt"><div class="h">${esc(title)}</div>` + rows.map(r => `<div class="r"><span>${r[2] ? `<i class="k" style="background:${r[2]}"></i>` : ''}${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('') + (foot ? `<div class="f">${esc(foot)}</div>` : '') + '</div>';
const axM2 = v => Math.abs(v) >= 1e6 ? nf1.format(v / 1e6) + ' mi' : Math.abs(v) >= 1e3 ? (Math.abs(v) < 1e4 && v % 1e3 ? nf1 : nf0).format(v / 1e3) + ' mil' : nf0.format(v);   // 1,2 mil (não "1 mil" repetido)

/* ── tabela genérica ──────────────────────────────────── */
/* opts: sort {k, d} · sel(r) linha marcada · rowAttr(r) · onRow(r, ev) · rowLink (só o link/botão da linha navega, não a linha toda)
   · pin(r) linhas fixas no topo em qualquer ordenação (número = ordem entre elas) · page N (mostra N linhas + "mostrar mais", sem rolagem interna) · pageKey
   (quando muda, volta à 1ª página). Ordenar volta à 1ª página e ao topo da tabela. */
/* 30/09: toda tabela mostra TODAS as linhas (pedido do usuário; substitui a paginação de 28/09). `opts.page` dos
   chamadores é aceito e ignorado — para voltar a paginar, basta TABLE_SHOW_ALL = false. */
const TABLE_SHOW_ALL = true;
function table(el, id, cols, rows, opts = {}) {
  if (TABLE_SHOW_ALL && opts.page) opts = Object.assign({}, opts, {page: 0});
  const st = S.sorts[id] || opts.sort || null;
  let rs = rows.slice();
  if (st) {
    const c = cols.find(c => c.k === st.k);
    if (c) {
      const sv = c.sv || (r => r[c.k]);
      rs.sort((a, b) => { const x = sv(a), y = sv(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (st.d === 'asc' ? 1 : -1); });
    }
  }
  if (opts.pin) rs = rs.filter(opts.pin).sort((x, y) => opts.pin(x) - opts.pin(y)).concat(rs.filter(r => !opts.pin(r)));   // pin numérico: ordem entre as fixas
  const total = rs.length;
  if (opts.page) {
    const pk = String(opts.pageKey != null ? opts.pageKey : ''), pg = S.pages[id];
    if (!pg || pg.key !== pk) S.pages[id] = {key: pk, n: opts.page};
    rs = rs.slice(0, S.pages[id].n);
  }
  const th = cols.map(c => `<th class="${c.n ? 'n ' : ''}${c.sort === false ? '' : 'sortable'}" data-k="${c.k}" ${c.title ? `title="${esc(c.title)}"` : ''} scope="col">${c.label}${st && st.k === c.k ? `<span class="ar">${st.d === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('');
  const tb = rs.map(r => `<tr${opts.sel && opts.sel(r) ? ' class="sel"' : ''}${opts.rowAttr ? ' ' + opts.rowAttr(r) : ''}>` + cols.map(c => `<td class="${c.n ? 'n ' : ''}${c.cls || ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('') + '</tr>').join('');
  const more = opts.page && total > rs.length ? `<div class="tmore"><span>mostrando ${nf0.format(rs.length)} de ${nf0.format(total)}</span><button type="button" data-more="${opts.page}">mostrar mais ${nf0.format(Math.min(opts.page, total - rs.length))}</button>${total - rs.length > opts.page ? `<button type="button" data-more="all">todos</button>` : ''}</div>` :
    opts.page && total > opts.page ? `<div class="tmore"><span>${nf0.format(total)} linhas</span><button type="button" data-more="less">mostrar menos</button></div>` : '';
  el.innerHTML = `<table class="t${opts.onRow ? ' clk' : ''}${opts.rowLink ? ' lnk' : ''}"><thead><tr>${th}</tr></thead><tbody>${tb || `<tr><td colspan="${cols.length}" class="sup">sem registros</td></tr>`}</tbody></table>${more}`;
  el.querySelectorAll('th.sortable').forEach(h => h.addEventListener('click', () => {
    const k = h.dataset.k, cur = S.sorts[id] || opts.sort;
    S.sorts[id] = {k, d: cur && cur.k === k && cur.d === 'desc' ? 'asc' : 'desc'};
    if (S.pages[id]) S.pages[id].n = opts.page;
    table(el, id, cols, rows, opts);
    el.scrollTop = 0;
  }));
  el.querySelectorAll('.tmore button').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.more; S.pages[id].n = m === 'all' ? Infinity : m === 'less' ? opts.page : S.pages[id].n + (+m);
    const top = el.getBoundingClientRect().top;
    table(el, id, cols, rows, opts);
    if (m === 'less' && top < 0) el.scrollIntoView({block: 'start'});
  }));
  if (opts.onRow) el.querySelectorAll('tbody tr').forEach((tr, i) => tr.addEventListener('click', ev => {
    if (!rs[i]) return;
    if (opts.rowLink && !ev.target.closest('button, a')) return;
    opts.onRow(rs[i], ev);
  }));
}
