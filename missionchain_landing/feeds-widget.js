/* Mission Chain — Landing feed widget (self-contained, additive).
   Reads #mic-feed[data-lang][data-viewall], fetches api.missionchain.io/feeds. */
(function () {
  var C = document.getElementById('mic-feed');
  if (!C) return;
  var API = 'https://api.missionchain.io/feeds';
  var lang = C.getAttribute('data-lang') || '';
  var viewAll = C.getAttribute('data-viewall') || 'View all';
  var FEED_URL = 'https://app.missionchain.io/feeds';

  if (!document.getElementById('mic-feed-style')) {
    var st = document.createElement('style');
    st.id = 'mic-feed-style';
    st.textContent = [
      '#mic-feed .micf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:20px;margin-top:50px}',
      '#mic-feed .micf-card{background:rgba(201,168,76,.045);border:1px solid rgba(201,168,76,.22);border-radius:16px;padding:22px;text-align:left;transition:transform .2s ease,border-color .2s ease}',
      '#mic-feed .micf-card:hover{transform:translateY(-3px);border-color:var(--gold,#C9A84C)}',
      '#mic-feed .micf-pill{font-family:"Montserrat",sans-serif;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--gold,#C9A84C);font-weight:700}',
      '#mic-feed .micf-title{font-family:"Montserrat",sans-serif;font-weight:700;font-size:17px;margin:8px 0 10px;line-height:1.4;color:inherit}',
      '#mic-feed .micf-img{width:100%;border-radius:10px;margin:6px 0 10px;display:block}',
      '#mic-feed .micf-body{font-family:"Montserrat",sans-serif;font-size:13.5px;line-height:1.6;opacity:.82;margin:0}',
      '#mic-feed .micf-verse{border-left:3px solid var(--gold,#C9A84C);margin:12px 0 0;padding:2px 0 2px 12px;font-style:italic;font-size:12.5px;opacity:.78}',
      '#mic-feed .micf-verse span{color:var(--gold,#C9A84C);font-style:normal;white-space:nowrap}',
      '#mic-feed .micf-src{font-size:11px;opacity:.55;margin-top:10px;font-family:"Montserrat",sans-serif}',
      '#mic-feed .micf-more{text-align:center;margin-top:36px}',
      '#mic-feed .micf-more a{font-family:"Montserrat",sans-serif;color:var(--gold,#C9A84C);text-decoration:none;font-weight:600;font-size:14px;border:1px solid var(--gold,#C9A84C);border-radius:999px;padding:10px 28px;display:inline-block;transition:background .2s ease}',
      '#mic-feed .micf-more a:hover{background:rgba(201,168,76,.12)}'
    ].join('');
    document.head.appendChild(st);
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
  function card(it) {
    var img = (it.media && it.media[0]) ? '<img class="micf-img" src="' + esc(it.media[0]) + '" alt="" loading="lazy">' : '';
    var verse = it.verseText ? '<blockquote class="micf-verse">“' + esc(it.verseText) + '” <span>— ' + esc(it.verseRef) + '</span></blockquote>' : '';
    var src = it.sourceAttribution ? '<div class="micf-src">' + esc(it.sourceAttribution) + '</div>' : '';
    return '<article class="micf-card"><span class="micf-pill">' + esc(it.pillar) + '</span>' +
      '<h3 class="micf-title">' + esc(it.title) + '</h3>' + img +
      '<p class="micf-body">' + esc(it.body) + '</p>' + verse + src + '</article>';
  }
  function render(items) {
    if (!items || !items.length) { C.style.display = 'none'; return; }
    C.innerHTML = '<div class="micf-grid">' + items.map(card).join('') + '</div>' +
      '<div class="micf-more"><a href="' + FEED_URL + '">' + esc(viewAll) + ' →</a></div>';
  }
  function load(l) {
    return fetch(API + '?limit=6' + (l ? '&lang=' + encodeURIComponent(l) : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d && d.items) || []; });
  }

  load(lang).then(function (items) {
    if (items.length) { render(items); return; }
    load('').then(render); // fallback: latest across languages
  }).catch(function () { C.style.display = 'none'; });
})();
