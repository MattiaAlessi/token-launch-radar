// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board of pre-token protocols, the live-token set, a detail view with the model's
// arithmetic and the farm plan, and the method behind the ranking. No network request: every
// byte it shows comes from data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D || !app) {
    document.body.textContent = 'Launch Radar: data.js is missing. Run main.ts and open /output/dashboard/.';
    return;
  }

  var PAGE = 50;
  var state = {
    q: '',
    cat: 'all',
    chain: 'all',
    wl: false,
    tab: 'board',
    sort: 'rank',
    dir: 1,
    page: 1,
    selected: null,
    focusQ: false
  };

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('wl') === '1') state.wl = true;
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    try {
      window.history.replaceState(null, '', next ? '#' + next : window.location.pathname);
    } catch (e) {
      window.location.hash = next;
    }
  }

  /* ---- formatting ---- */
  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function count(n) {
    return new Intl.NumberFormat('en-US').format(n);
  }
  function pctText(x) {
    return (x >= 1 ? '+' : '') + Math.round((x - 1) * 1000) / 10 + '%';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { node.addEventListener(ev, attrs.on[ev]); });
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    function append(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(append); return; }
      if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else node.appendChild(c);
    }
    for (var i = 2; i < arguments.length; i++) append(arguments[i]);
    return node;
  }

  /* ---- data views ---- */
  function categories() {
    var seen = {};
    D.rows.forEach(function (r) { seen[r.category || 'Other'] = (seen[r.category || 'Other'] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
  }
  function chains() {
    var seen = {};
    D.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = (seen[c] || 0) + 1; }); });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); }).slice(0, 24);
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    var out = list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'signal') { av = a.signal; bv = b.signal; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
    return out;
  }

  /* ---- header & hero ---- */
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('span', { class: 'brand-name', text: 'Launch Radar' }),
          el('span', { class: 'brand-sub', text: 'Pre-token protocols, ranked by what a launch could be worth' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: D.as_of })),
        el('span', null, 'Model ', el('b', { text: D.model_version })),
        el('span', null, 'DefiLlama index, ', el('b', { text: '758 protocols' }))
      )
    );
  }

  function kpi(label, value, sub, amber) {
    return el('div', { class: 'kpi' + (amber ? ' amber' : '') },
      el('span', { text: label }),
      el('b', { text: value }),
      sub ? el('small', { text: sub }) : null
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null, D.board_size, ' pre-token protocols, ranked by ', el('em', { text: 'implied value' })),
        el('p', null,
          'Every protocol in the sealed snapshot whose record carries no token, scored by one function of its TVL, seven-day growth and how long it has run without a launch. ',
          el('b', { text: D.watchlist_size + ' watchlist protocols are all covered' }),
          '; ' + D.early_size + ' more sit below the $' + Math.round(D.floor_usd / 1e6) + 'M floor. Each row carries a farm plan with its costs and its hold time.'
        )
      ),
      el('div', { class: 'kpis' },
        kpi('Watchlist', D.watchlist_size + ' / ' + D.watchlist_size, 'every floor protocol', true),
        kpi('Ranked', String(D.board_size), D.early_size + ' below the floor'),
        kpi('Total implied', usd(D.total_implied_usd), 'a model, not a price'),
        kpi('Median age', age(D.median_age_days), 'without a token'),
        kpi('Categories', String(D.category_count), D.chain_count + ' chains'),
        kpi('Live token', String(D.live_size), 'set aside, not ranked')
      )
    );
  }

  /* ---- controls ---- */
  function controls() {
    var search = el('input', {
      type: 'search', id: 'q', value: state.q, placeholder: 'Search protocol, category or chain',
      'aria-label': 'Search the board',
      on: {
        input: function () {
          state.q = search.value;
          state.focusQ = true;
          state.page = 1;
          writeHash();
          render();
        }
      }
    });
    var cats = categories().map(function (c) { return el('option', { value: c, text: c, selected: c === state.cat ? 'selected' : null }); });
    var catSel = el('select', {
      id: 'cat', 'aria-label': 'Filter by category',
      on: { change: function () { state.cat = catSel.value; state.page = 1; writeHash(); render(); } }
    }, el('option', { value: 'all', text: 'All categories', selected: state.cat === 'all' ? 'selected' : null }), cats);
    var chainSel = el('select', {
      id: 'chain', 'aria-label': 'Filter by chain',
      on: { change: function () { state.chain = chainSel.value; state.page = 1; writeHash(); render(); } }
    }, el('option', { value: 'all', text: 'All chains', selected: state.chain === 'all' ? 'selected' : null }),
      chains().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    var wl = el('input', {
      type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null,
      on: { change: function () { state.wl = wl.checked; state.page = 1; writeHash(); render(); } }
    });
    var preTab = el('button', {
      type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board',
      on: { click: function () { state.tab = 'board'; writeHash(); render(); } }
    });
    var liveTab = el('button', {
      type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token (' + D.live_size + ')',
      on: { click: function () { state.tab = 'live'; writeHash(); render(); } }
    });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'toggle', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'Universe' }), el('div', { class: 'tabs' }, preTab, liveTab)),
      el('span', { class: 'count' }, state.tab === 'board'
        ? [el('b', { text: count(filtered().length) }), ' of ' + D.board_size + ' rows']
        : [el('b', { text: String(D.live_size) }), ' live-token protocols']),
      state.q || state.cat !== 'all' || state.chain !== 'all' || state.wl
        ? el('button', {
            class: 'reset', type: 'button', text: 'Clear filters',
            on: { click: function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.wl = false; state.page = 1; writeHash(); render(); } }
          })
        : null
    );
  }

  /* ---- board table ---- */
  function sortTh(key, label, cls) {
    var arrow = state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir > 0 ? ' ↑' : ' ↓' }) : null;
    var button = el('button', {
      type: 'button',
      on: { click: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      } }
    }, label, arrow);
    return el('th', { scope: 'col', class: cls || null }, button);
  }

  function rowNode(r, max) {
    var g = r.change_7d;
    return el('tr', {
      tabindex: '0', 'data-selected': state.selected === r.slug ? 'true' : null,
      on: {
        click: function () { openDetail(r.slug); },
        keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      }
    },
      el('td', { class: 'num' }, el('span', { class: 'rank' + (r.rank <= 10 ? ' top' : ''), text: String(r.rank) })),
      el('td', null,
        el('div', { class: 'name' }, el('b', { text: r.name })),
        el('div', { class: 'chips' },
          el('span', { class: 'chip', text: r.category || 'Other' }),
          r.chains.length ? el('span', { class: 'chip', text: r.chains.slice(0, 2).join(' · ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }) : null,
          r.watchlist ? el('span', { class: 'chip wl', text: 'watchlist' }) : el('span', { class: 'chip early', text: 'early' })
        )
      ),
      el('td', { class: 'num col-tvl', text: usd(r.tvl_usd) }),
      el('td', { class: 'num col-change ' + (g === null ? '' : g >= 0 ? 'pos' : 'neg'), text: pct(g) }),
      el('td', { class: 'num col-age', text: age(r.age_days) }),
      el('td', { class: 'col-signal' },
        el('div', { class: 'signal' },
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, r.signal) + '%' })),
          el('span', { text: String(r.signal) })
        )
      ),
      el('td', { class: 'num' },
        el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('b', { text: usd(r.implied_value_usd) })
        )
      )
    );
  }

  function board() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches those filters' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', {
          class: 'button', type: 'button', text: 'Clear filters',
          on: { click: function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.wl = false; state.page = 1; writeHash(); render(); } }
        })
      ));
    }
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * PAGE, state.page * PAGE);
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    slice.forEach(function (r) { tbody.appendChild(rowNode(r, max)); });
    var from = (state.page - 1) * PAGE + 1;
    var to = Math.min(list.length, state.page * PAGE);
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', null,
            'Pre-token protocols, strongest implied value first. Select a row for its arithmetic, risk notes and farm plan. ',
            'Rank is the model’s claim, not a promise of a token.'
          ),
          el('thead', null, el('tr', null,
            sortTh('rank', 'Rank', 'num'),
            sortTh('name', 'Protocol'),
            sortTh('tvl', 'TVL', 'num col-tvl'),
            sortTh('growth', '7d', 'num col-change'),
            sortTh('age', 'Age', 'num col-age'),
            sortTh('signal', 'Signal', 'col-signal'),
            sortTh('implied', 'Implied value', 'num')
          )),
          tbody
        )
      ),
      el('div', { class: 'pager' },
        el('span', null, 'Showing ' + from + '–' + to + ' of ' + count(list.length)),
        el('span', null,
          el('button', { type: 'button', text: 'Previous', disabled: state.page <= 1 ? 'disabled' : null, on: { click: function () { state.page = Math.max(1, state.page - 1); render(); } } }),
          ' ',
          el('button', { type: 'button', text: 'Next', disabled: state.page >= pages ? 'disabled' : null, on: { click: function () { state.page = Math.min(pages, state.page + 1); render(); } } })
        )
      )
    );
  }

  /* ---- live token table ---- */
  function liveTable() {
    var tbody = el('tbody');
    D.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'chip', text: 'live' })),
        el('td', null,
          el('div', { class: 'name' }, el('b', { text: r.name })),
          el('div', { class: 'chips' }, el('span', { class: 'chip', text: r.category || 'Other' }), r.chains.length ? el('span', { class: 'chip', text: r.chains.slice(0, 2).join(' · ') }) : null)
        ),
        el('td', { class: 'num col-tvl', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.ratio === null ? 'n/a' : r.ratio.toFixed(2) + '×' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their value is a fact, not a model. They are set aside from the pre-token ranking, never mixed into it. mcap/TVL compares the market’s price with the protocol’s TVL.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num col-tvl', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num col-change', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'num', text: 'mcap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  /* ---- method ---- */
  function method() {
    var m = D.model;
    var catCounts = {};
    D.rows.forEach(function (r) {
      var c = r.category || 'Other';
      catCounts[c] = catCounts[c] || { n: 0, mult: r.model.category_multiple };
      catCounts[c].n++;
    });
    var topCats = Object.keys(catCounts).sort(function (a, b) { return catCounts[b].n - catCounts[a].n; }).slice(0, 10);
    return el('section', { class: 'method' },
      el('div', { class: 'card' },
        el('h2', { text: 'How implied value is computed' }),
        el('p', { text: 'One function scores every row from five factors, each drawn from the snapshot. No protocol name is special-cased, so a new protocol of a known kind is scored the moment it appears.' }),
        el('div', { class: 'formula', text:
          'implied = round( tvl_usd x ' + m.base_multiple +
          '\n                    x category_multiple' +
          '\n                    x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')% x ' + m.growth_weight + ')' +
          '\n                    x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')' +
          '\n                    x (1 + ' + m.chain_step + ' x (min(chains, ' + m.chain_cap + ') - 1)) )'
        }),
        el('div', { class: 'factors' },
          el('div', null, el('span', { text: 'Base FDV / TVL' }), el('b', { text: String(m.base_multiple) })),
          el('div', null, el('span', { text: 'Growth clamp' }), el('b', { text: m.growth_floor + '% … +' + m.growth_cap + '%' })),
          el('div', null, el('span', { text: 'Growth weight' }), el('b', { text: String(m.growth_weight) })),
          el('div', null, el('span', { text: 'Maturity floor' }), el('b', { text: String(m.maturity_floor) })),
          el('div', null, el('span', { text: 'Maturity window' }), el('b', { text: m.maturity_days + ' days' })),
          el('div', null, el('span', { text: 'Missing age' }), el('b', { text: m.unknown_age_days + ' days' }))
        ),
        el('div', { class: 'catlist' }, topCats.map(function (c) {
          return el('span', { class: 'chip', text: c + ' ×' + catCounts[c].mult });
        }))
      ),
      el('div', { class: 'card' },
        el('h2', { text: 'How to read the board' }),
        el('p', null, el('b', { text: 'The watchlist is the floor, not the ceiling. ' }), 'It holds the ' + D.watchlist_size + ' protocols at or above $' + Math.round(D.floor_usd / 1e6) + 'M of TVL with no token on record, no version marker and no wrapped, staked or exchange product. The board adds ' + D.early_size + ' smaller pre-token protocols, because a launch rarely waits for size.'),
        el('p', null, el('b', { text: 'Implied value is a model, not a price. ' }), 'It says what a token could be worth if the protocol’s record stayed as it is. It does not say a token will exist, when, or at what terms.'),
        el('p', null, el('b', { text: 'Records can be incomplete. ' }), 'Say a protocol “records no token”; DefiLlama may miss one. The live-token table keeps every protocol whose token already trades out of the ranking.'),
        el('p', null, el('b', { text: 'Farm plans are templates. ' }), 'They are derived from the protocol’s category, chains, TVL and age, with capital, gas and hold time stated. Check the protocol’s own site before you move funds; nothing here is financial advice.')
      )
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', null, el('b', { text: 'Snapshot ' + D.as_of + '. ' }), D.source),
      el('span', { text: 'Launch Radar · ' + D.model_version + ' · implied value is a model, not a price' })
    );
  }

  /* ---- detail ---- */
  var dialog = el('dialog', { class: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
  });

  function factorRow(label, why, value, multiplier, barPct) {
    return el('div', { class: 'row' },
      el('div', null, el('span', { text: label }), el('div', { class: 'why', text: why })),
      el('div', { class: 'factorbar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.min(100, barPct)) + '%' })),
      el('b', { text: value })
    );
  }

  function whyText(r) {
    var m = r.model;
    var bits = [];
    bits.push('Rank ' + r.rank + ' because ' + usd(r.tvl_usd) + ' of TVL at a ' + m.category_multiple + '× category premium gives a base of ' + usd(r.tvl_usd * m.base_multiple) + '.');
    var g = r.change_7d;
    bits.push(g === null ? 'DefiLlama reports no seven-day change, so the growth factor is neutral.' : 'Seven-day TVL change of ' + pct(g) + ' moves the value by ' + pctText(m.growth_multiplier) + '.');
    bits.push(r.age_days === null ? 'No listing date is recorded, so the model assumes 270 days without a token.' : 'It has run ' + age(r.age_days) + ' without a token on record, which sets the maturity factor at ' + m.maturity_multiplier + '×.');
    if (r.notes.length) bits.push('Watch: ' + r.notes.join('; ') + '.');
    return bits.join(' ');
  }

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
    if (!r) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var m = r.model;
    var maxMult = Math.max(1.5, m.category_multiple, m.growth_multiplier, m.maturity_multiplier, m.chain_multiplier);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('div', { class: 'kicker', text: 'Rank ' + r.rank + ' of ' + D.board_size + ' · ' + (r.watchlist ? 'watchlist' : 'early radar') }),
        el('h2', { id: 'detail-title', text: r.name }),
        el('div', { class: 'chips' },
          el('span', { class: 'chip', text: r.category || 'Other' }),
          r.chains.length ? el('span', { class: 'chip', text: r.chains.join(' · ') }) : el('span', { class: 'chip', text: 'no chain recorded' }),
          el('span', { class: 'chip', text: 'records no token' })
        )
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', 'aria-label': 'Close the detail view', on: { click: function () { dialog.close(); } } })
    ));

    var body = el('div', { class: 'detail-body' });
    body.appendChild(el('div', { class: 'statgrid' },
      el('div', { class: 'stat' }, el('span', { text: 'TVL' }), el('b', { text: usd(r.tvl_usd) })),
      el('div', { class: 'stat' }, el('span', { text: '7-day' }), el('b', { class: r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg', text: pct(r.change_7d) })),
      el('div', { class: 'stat' }, el('span', { text: 'Age' }), el('b', { text: age(r.age_days) })),
      el('div', { class: 'stat' }, el('span', { text: 'Signal' }), el('b', { text: r.signal + ' / 100' })),
      el('div', { class: 'stat' }, el('span', { text: 'Chains' }), el('b', { text: String(r.chains.length) })),
      el('div', { class: 'stat' }, el('span', { text: 'Implied' }), el('b', { text: usd(r.implied_value_usd) }))
    ));

    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The arithmetic' }),
      el('div', { class: 'equation' },
        factorRow('TVL', 'from the snapshot, in whole dollars', usd(r.tvl_usd), null, (Math.log10(Math.max(r.tvl_usd, 1)) / 10) * 100),
        factorRow('Base value', 'TVL × ' + m.base_multiple, usd(r.tvl_usd * m.base_multiple), null, 30),
        factorRow('Category', (r.category || 'Other') + ' premium', '×' + m.category_multiple, null, (m.category_multiple / maxMult) * 100),
        factorRow('Growth', 'clamped 7-day change ' + pct(m.growth_pct), '×' + m.growth_multiplier, null, (m.growth_multiplier / maxMult) * 100),
        factorRow('Maturity', 'time without a token', '×' + m.maturity_multiplier, null, (m.maturity_multiplier / maxMult) * 100),
        factorRow('Reach', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), '×' + m.chain_multiplier, null, (m.chain_multiplier / maxMult) * 100),
        el('div', { class: 'row total' },
          el('div', null, el('span', { text: 'Implied value' }), el('div', { class: 'why', text: 'the board’s claim, not a price' })),
          el('div', { class: 'meter' }, el('div', { class: 'track' }, el('i', { style: 'width:' + Math.min(100, Math.max(4, r.signal)) + '%' })), el('b', { text: r.signal })),
          el('b', { text: usd(r.implied_value_usd) })
        )
      ),
      el('p', { class: 'why-text', text: '', style: '' })
    ));

    // The page recomputes the row from the snapshot figures, so the number shown and the
    // arithmetic beside it are visibly the same function.
    var check = Math.round(r.tvl_usd * m.base_multiple * m.category_multiple * m.growth_multiplier * m.maturity_multiplier * m.chain_multiplier);
    var same = Math.abs(check - r.implied_value_usd) <= Math.max(2, r.implied_value_usd * 0.002);
    body.lastChild.lastChild.textContent = whyText(r) + ' The page recomputes this row as ' + usd(check) + (same ? ', the same number board.json carries, to rounding.' : ', which differs from the board: the data would be stale.');

    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, r.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));

    if (r.notes.length) {
      body.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Flags' }),
        el('div', { class: 'notes' }, r.notes.map(function (n) { return el('span', { class: 'chip', text: n }); }))
      ));
    }
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /* ---- render ---- */
  function render() {
    window.__shotReady = false;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? board() : liveTable());
    if (state.tab === 'board') shell.appendChild(method());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    if (state.focusQ) {
      state.focusQ = false;
      var q = document.getElementById('q');
      if (q) {
        q.focus();
        var v = q.value;
        q.value = '';
        q.value = v;
      }
    }
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
