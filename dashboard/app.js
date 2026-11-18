// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view
// with the model's own factor breakdown and farm plan, and a model sandbox
// that recomputes every row live. No network: every byte shown is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    sandbox: false, growthWeight: DATA.model.growth_weight, maturityFloor: DATA.model.maturity_floor
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, as the page recomputes it: the same arithmetic main.ts ran, so
  // the number on screen and the number board.json carries are visibly one.
  function impliedOf(row, model) {
    var m = model || DATA.model;
    var gw = state.sandbox ? state.growthWeight : m.growth_weight;
    var mf = state.sandbox ? state.maturityFloor : m.maturity_floor;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * gw;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = mf + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.sector_multiple * growthMult * maturity * row.breadth_multiplier));
  }
  function effectiveRows() {
    return DATA.rows.map(function (r) {
      var copy = {};
      for (var k in r) copy[k] = r[k];
      copy.eff_implied = state.sandbox ? impliedOf(r) : r.implied_value_usd;
      return copy;
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return effectiveRows().filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var val = function (r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
      if (key === 'sector') return r.sector_multiple;
      return r.eff_implied;
    };
    return list.slice().sort(function (a, b) {
      var av = val(a), bv = val(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      ));
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: fmtUsd(DATA.floor_usd) }),
          ' of TVL that records no token. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor. The most valuable launch on the board is ',
          el('b', { text: top ? top.name : '—' }),
          ' at ',
          el('b', { text: top ? fmtUsd(top.implied_value_usd) : '—' }),
          '. Implied value is a model, not a promise — and never a claim that a token will launch.'
        )),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows scored' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'Early rows below the floor' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'Live-token protocols set aside' }))
      ));
  }

  function spotlight() {
    var top5 = DATA.rows.slice(0, 5);
    var cards = top5.map(function (r) {
      return el('button', { class: 'spot-card', type: 'button', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: 'RANK ' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) }),
        el('span', { class: 'imp', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'sub', text: 'Farm from $' + r.farm_capital_usd + ' · hold ' + r.hold_days + 'd' }));
    });
    return el('section', { class: 'spot' },
      el('div', { class: 'spot-head' },
        el('h2', { text: 'Top 5 launches to watch' }),
        el('span', { text: 'Select any card for its model and farm plan' })),
      cards);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var tvl = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [[0, 'Any TVL'], [50e6, 'TVL $50M+'], [100e6, 'TVL $100M+'], [500e6, 'TVL $500M+'], [1e9, 'TVL $1B+']].map(function (o) {
        return el('option', { value: String(o[0]), text: o[1], selected: state.minTvl === o[0] ? 'selected' : null });
      }));
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var n = state.tab === 'pre-token' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    if (state.sandbox) n += ' · sandbox on';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: n }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }

  function boardTable() {
    var list = sortedRows(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.eff_implied; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: 'x' + r.sector_multiple.toFixed(2) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.eff_implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.eff_implied) }))),
        el('td', null, el('span', { class: 'pill', text: 'no token' })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('sector', 'Sector x'),
            sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'pill live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? 'x' + (r.mcap_usd / r.tvl_usd).toFixed(2) : 'n/a' })));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody)));
  }

  function sandboxPanel() {
    var m = DATA.model;
    var gw = el('input', { type: 'range', id: 'gw', min: '0', max: '1', step: '0.05', value: String(state.growthWeight), 'aria-label': 'Growth weight' });
    var mf = el('input', { type: 'range', id: 'mf', min: '0.4', max: '0.8', step: '0.05', value: String(state.maturityFloor), 'aria-label': 'Maturity floor' });
    var out = el('span', { class: 'sandbox-out', id: 'sandbox-out' });
    function sync() {
      state.growthWeight = Number(gw.value);
      state.maturityFloor = Number(mf.value);
      state.sandbox = state.growthWeight !== m.growth_weight || state.maturityFloor !== m.maturity_floor;
      out.textContent = 'growth weight ' + state.growthWeight.toFixed(2) + ' · maturity floor ' + state.maturityFloor.toFixed(2) + (state.sandbox ? ' · live' : ' · at model defaults');
      render();
    }
    gw.addEventListener('input', sync);
    mf.addEventListener('input', sync);
    out.textContent = 'growth weight ' + state.growthWeight.toFixed(2) + ' · maturity floor ' + state.maturityFloor.toFixed(2) + (state.sandbox ? ' · live' : ' · at model defaults');
    return el('section', { class: 'panel note-panel' },
      el('h2', { text: 'Model sandbox — change the model, watch the board move' }),
      el('p', { class: 'sub', text: 'The board above is scored with the model defaults. Move a slider and every row is rescored by the same function main.ts ran — proof the ranking is arithmetic, not a hand-picked list.' }),
      el('div', { class: 'sandbox-row' },
        el('div', { class: 'field' }, el('label', { for: 'gw', text: 'Growth weight' }), gw),
        el('div', { class: 'field' }, el('label', { for: 'mf', text: 'Maturity floor' }), mf),
        el('button', { class: 'button', type: 'button', text: 'Reset to defaults', onclick: function () { state.growthWeight = m.growth_weight; state.maturityFloor = m.maturity_floor; state.sandbox = false; render(); } })),
      out);
  }

  function methodPanel() {
    var m = DATA.model;
    var rows = DATA.sectors.slice(0, 8).map(function (s) {
      return el('tr', null,
        el('td', { text: s.category }),
        el('td', { class: 'num', text: 'x' + s.multiple.toFixed(2) }),
        el('td', { class: 'num', text: s.fallback ? 'market median' : String(s.comps) + ' live comps' }));
    });
    return el('section', { class: 'panel note-panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every protocol. No name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text:
        'implied = round( tvl_usd x sector_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.breadth_max_chains + ') x ' + m.breadth_per_chain + ') )' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Sector multiple: ' }), 'the median market-cap-per-TVL of live-token protocols in the same category (at least 3 comps); categories with too few fall back to the whole live market median, x' + DATA.overall_multiple.toFixed(2) + '.'),
        el('li', null, el('b', { text: 'Growth: ' }), 'seven-day TVL change, clamped so one spike cannot carry a rank.'),
        el('li', null, el('b', { text: 'Maturity: ' }), 'time since first listed — how long the protocol has run with no token on record. Unknown ages use ' + m.unknown_age_days + ' days.'),
        el('li', null, el('b', { text: 'Breadth: ' }), 'a small premium for running on more chains.'),
        el('li', null, el('b', { text: 'Watchlist rule: ' }), 'TVL at or above ' + fmtUsd(DATA.floor_usd) + ', no token recorded, and not a wrapped, staked or bridged product of one that trades. A protocol “records no token” — the snapshot is DefiLlama\u2019s record, not proof it has none.')),
      el('table', { class: 'sectors' },
        el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Multiple' }), el('th', { text: 'Based on' }))),
        el('tbody', null, rows)));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var sector = DATA.sectors.filter(function (s) { return s.category === (row.category || 'Other'); })[0];
    var factors = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Sector multiple', 'x' + row.sector_multiple.toFixed(2) + (sector ? (sector.fallback ? ' (market median)' : ' (' + sector.comps + ' live comps)') : '')],
      ['Seven-day growth', fmtPct(row.change_7d) + ' → x' + row.growth_multiplier.toFixed(2)],
      ['Age with no token', fmtAge(row.age_days) + ' → x' + row.maturity_multiplier.toFixed(2)],
      ['Chain breadth', (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ' → x' + row.breadth_multiplier.toFixed(2)],
      ['Implied value', fmtUsd(row.implied_value_usd)]
    ];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rankline', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · first listed ' + (row.listed_at || 'unknown') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this rank — the model\u2019s own factors' }),
      el('div', { class: 'equation' }, factors.map(function (f) {
        return el('div', null, el('span', { text: f[0] }), el('b', { class: 'num', text: f[1] }));
      })),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board — the data would be stale.') + ' This is an estimate, not a price, and not a prediction that a token launches.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — from $' + row.farm_capital_usd + ', hold ' + row.hold_days + ' days' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'warn', text: 'Never pay to claim an airdrop, and never connect a wallet from a link in a DM. Claim only from the protocol\u2019s own published page.' })));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      var below = el('div', { class: 'below' });
      below.appendChild(sandboxPanel());
      below.appendChild(methodPanel());
      shell.appendChild(below);
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
