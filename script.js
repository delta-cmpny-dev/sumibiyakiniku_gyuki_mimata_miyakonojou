(function () {
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });

  els.forEach(function (el) { io.observe(el); });
})();

(function () {
  var slides = document.querySelectorAll('.hero__slide');
  if (slides.length < 2) return;

  var hero = slides[0].closest('.hero');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var INTERVAL = 3000;
  var current = 0;
  var timer = null;

  var wrap = document.createElement('div');
  wrap.className = 'hero__dots';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'トップ画像の切り替え');

  var dots = Array.prototype.map.call(slides, function (_, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'hero__dot';
    b.setAttribute('aria-label', (i + 1) + '枚目を表示');
    b.addEventListener('click', function () { show(i); restart(); });
    wrap.appendChild(b);
    return b;
  });
  hero.appendChild(wrap);

  function show(i) {
    current = i;
    slides.forEach(function (s, n) { s.classList.toggle('is-active', n === i); });
    dots.forEach(function (d, n) {
      d.classList.toggle('is-active', n === i);
      if (n === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
  }

  var rootEl = document.documentElement;
  function restart() {
    clearInterval(timer);
    // 開く前の演出の間は数えない（終わってから3秒ごとに切り替える）
    if (reduce || rootEl.classList.contains('has-intro')) return;
    timer = setInterval(function () { show((current + 1) % slides.length); }, INTERVAL);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearInterval(timer); else restart();
  });

  show(0);
  restart();
  // 演出が終わって幕が外れたら（押して飛ばした時・保険で外れた時も）、そこから数え始める
  if (rootEl.classList.contains('has-intro') && 'MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (!rootEl.classList.contains('has-intro')) { mo.disconnect(); restart(); }
    });
    mo.observe(rootEl, { attributes: true, attributeFilter: ['class'] });
  }
})();

(function () {
  var bar = document.querySelector('.top-bar');
  if (!bar) return;
  function setBarHeight() {
    document.documentElement.style.setProperty('--top-bar-h', bar.offsetHeight + 'px');
  }
  setBarHeight();
  window.addEventListener('resize', setBarHeight);

  // 別のページから「#lunch」などで来た時、帯の高さが分かってから、もう一度その見出しへ合わせる
  window.addEventListener('load', function () {
    setBarHeight();
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  });
})();
