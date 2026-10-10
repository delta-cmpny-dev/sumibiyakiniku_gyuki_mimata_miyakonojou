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
  var INTERVAL = 6000;
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

  function restart() {
    clearInterval(timer);
    if (reduce) return;
    timer = setInterval(function () { show((current + 1) % slides.length); }, INTERVAL);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearInterval(timer); else restart();
  });

  show(0);
  restart();
})();
