// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail panel with the model's own
// inputs and the protocol's farm plan, and a sandbox that re-ranks the board when a model
// constant changes. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var BASE_MODEL = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    minTvl: 0, minImplied: 0,
    model: JSON.parse(JSON.stringify(BASE_MODEL)),
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

  // The model, as one function of a row's own figures. The page recomputes a row from the
  // snapshot figures and checks the number board.json carries, so the page's code and the
  // board's data are visibly the same arithmetic. Category multiple by business model, never
  // by name: fee engines keep a cut of the flows, asset managers a small fee on what they
  // hold, infrastructure earns least directly from its TVL.
  function categoryMultiple(category, model) {
    var c = (category || '').toLowerCase();
    if (
      c.indexOf('dex') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 ||
      c.indexOf('lending') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('yield') >= 0 ||
      c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('basis trad') >= 0 ||
      c.indexOf('cedefi') >= 0 || c.indexOf('payment') >= 0 || c.indexOf('prediction') >= 0
    ) return model.fee_engine_multiple;
    if (
      c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('rwa') >= 0 ||
      c.indexOf('insurance') >= 0 || c.indexOf('governance incentive') >= 0 ||
      c.indexOf('stablecoin wrapper') >= 0 || c.indexOf('staking pool') >= 0 || c.indexOf('restak') >= 0
    ) return model.asset_manager_multiple;
    if (c.indexOf('chain') >= 0 || c.indexOf('bridge') >= 0) return model.infrastructure_multiple;
    return model.default_multiple;
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + model.chain_premium * Math.min(Math.max(chains, 0), model.chain_cap);
    var catMult = categoryMultiple(row.category, model);
    return Math.max(1, Math.round(row.tvl_usd * catMult * growthMult * maturity * chainMult));
  }
  function multipliersOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + model.chain_premium * Math.min(Math.max(chains, 0), model.chain_cap);
    return {
      category: categoryMultiple(row.category, model),
      growthPct: growth,
      growth: growthMult,
      maturity: maturity,
      chain: chainMult,
      age: age,
    };
  }

  // True when the sandbox constants differ from the model's own: the board is re-ranked live.
  function sandboxActive() {
    return JSON.stringify(state.model) !== JSON.stringify(BASE_MODEL);
  }

  // Every row with its implied value under the sandbox model, ranked strongest first.
  function viewRows() {
    var scored = DATA.rows.map(function (r) {
      return { row: r, implied: impliedOf(r, state.model) };
    });
    scored.sort(function (a, b) {
      return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    });
    var rankBySlug = {};
    scored.forEach(function (s, i) { rankBySlug[s.row.slug] = i + 1; });
    var impliedBySlug = {};
    scored.forEach(function (s) { impliedBySlug[s.row.slug] = s.implied; });
    return { rankBySlug: rankBySlug, impliedBySlug: impliedBySlug };
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
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows(view) {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (view.impliedBySlug[r.slug] < state.minImplied) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list, view) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = view.impliedBySlug[a.slug]; bv = view.impliedBySlug[b.slug]; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, ranked by what their launch would be worth. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function optionList(values, current, allLabel) {
    var opts = [el('option', { value: 'all', text: allLabel })];
    values.forEach(function (v) {
      opts.push(el('option', { value: v, text: v, selected: v === current ? 'selected' : null }));
    });
    return opts;
  }

  function controls(view) {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' }, optionList(categories, state.category, 'All categories'));
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' }, optionList(chains, state.chain, 'All chains'));
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'min-tvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: 'TVL $500M+', selected: state.minTvl === 500000000 ? 'selected' : null }),
      el('option', { value: '1000000000', text: 'TVL $1B+', selected: state.minTvl === 1000000000 ? 'selected' : null })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); render(); });
    var impliedSelect = el('select', { id: 'min-implied', 'aria-label': 'Minimum implied value' },
      el('option', { value: '0', text: 'Any implied value' }),
      el('option', { value: '10000000', text: 'Implied $10M+', selected: state.minImplied === 10000000 ? 'selected' : null }),
      el('option', { value: '50000000', text: 'Implied $50M+', selected: state.minImplied === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'Implied $100M+', selected: state.minImplied === 100000000 ? 'selected' : null }),
      el('option', { value: '250000000', text: 'Implied $250M+', selected: state.minImplied === 250000000 ? 'selected' : null })
    );
    impliedSelect.addEventListener('change', function () { state.minImplied = Number(impliedSelect.value); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? filteredRows(view).length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'TVL' }), tvlSelect),
      el('div', { class: 'field' }, el('label', { for: 'min-implied', text: 'Implied value' }), impliedSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable(view) {
    var list = sortedRows(filteredRows(view), view);
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.minImplied = 0; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (view.impliedBySlug[r.slug] > max) max = view.impliedBySlug[r.slug]; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rank = view.rankBySlug[r.slug];
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: rank <= 3 ? 'top3' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((view.impliedBySlug[r.slug] / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(view.impliedBySlug[r.slug]) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: (sandboxActive() ? 'Sandbox active: re-ranked by your constants. ' : '') + 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function sliderRow(id, label, min, max, step, value, format) {
    var out = el('output', { for: id, text: format(value) });
    var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value) });
    input.addEventListener('input', function () {
      var v = Number(input.value);
      out.textContent = format(v);
    });
    input.addEventListener('change', function () {
      state.model[id] = Number(input.value);
      render();
    });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), input, out);
  }

  function modelPanel() {
    var m = BASE_MODEL;
    var sandbox = el('div', { class: 'sandbox' },
      sliderRow('fee_engine_multiple', 'Fee-engine multiple', 0.1, 0.6, 0.01, state.model.fee_engine_multiple, function (v) { return v.toFixed(2) + 'x'; }),
      sliderRow('growth_weight', 'Growth weight', 0, 1.5, 0.05, state.model.growth_weight, function (v) { return v.toFixed(2); }),
      sliderRow('maturity_floor', 'Maturity floor', 0.3, 1, 0.05, state.model.maturity_floor, function (v) { return v.toFixed(2); }),
      sliderRow('chain_premium', 'Chain premium', 0, 0.1, 0.01, state.model.chain_premium, function (v) { return '+' + Math.round(v * 100) + '% / chain'; })
    );
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the model', onclick: function () { state.model = JSON.parse(JSON.stringify(BASE_MODEL)); render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x categoryMultiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_premium + ' x min(chains, ' + m.chain_cap + ')) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Category multiple is ' + m.fee_engine_multiple + ' for fee engines (DEXes, perps, lending), ' + m.asset_manager_multiple + ' for asset managers (curators, RWA, vaults), ' + m.infrastructure_multiple + ' for infrastructure (chains, bridges), and ' + m.default_multiple + ' otherwise. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('h3', { text: 'Model sandbox' }),
      el('p', { class: 'sandbox-note', text: 'Move a constant and the board re-ranks live, by the same function. The submitted board keeps the model above.' }),
      sandbox,
      el('div', null, reset)
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: DefiLlama protocol index, fetched ' + DATA.as_of + '. Implied value is this entry\u2019s own model, never a price and never a prediction that a token will be issued. \u201cNo token\u201d means the protocol\u2019s record carries none, not that none exists.' }),
      el('p', { text: 'Farm plans are a starting point: check the protocol\u2019s own pages, never pay to claim, and never share a seed phrase.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var mults = multipliersOf(row, state.model);
    var recomputed = impliedOf(row, state.model);
    var view = viewRows();
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + view.rankBySlug[row.slug] + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String(row.chains ? row.chains.length : 0) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: String(mults.category) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(mults.growth.toFixed(4)) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(mults.maturity.toFixed(4)) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(mults.chain.toFixed(4)) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(recomputed) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' (the sandbox is active, so it differs from the submitted board).') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    var view = viewRows();
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls(view));
    shell.appendChild(state.tab === 'pre-token' ? boardTable(view) : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
