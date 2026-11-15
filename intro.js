/* 開く前の演出（2026-11-15 試作D・E）
 * D（data-variant="d"）：「炭火焼肉 牛輝」の文字だけが、紙のように下から燃えていき（右側が少し先）、灰と火の粉を上げて消える。
 * E（data-variant="e"・トップで使う）：その逆。何も無い所に、下から燃えかすが現れ、火の縁が上がっていくと、その後ろに文字が焼き上がって現れる（左側が少し先）。
 * 燃える縁は細く、場所ごとに明るさがちらつき（均一に光らせない）、前は茶色く焦げ、後ろは黒く焦げて崩れ落ちる。
 * 大きな炎や丸くぼやけた光の粒は使わない（作り物っぽく見えるため）。
 * 画面に重ねた canvas に描く。押すと飛ばせる。終わったら重ねた物を外す。
 * ?introcapture を付けると自動では動かず、window.__intro.step(秒) で1コマずつ進める（動画を作る時用）。
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('has-intro')) return;
  var overlay = document.querySelector('.intro');
  if (!overlay) return;

  var canvas = overlay.querySelector('.intro__canvas');
  var ctx = canvas.getContext('2d');
  var capture = /[?&]introcapture\b/.test(location.search);
  var reveal = overlay.getAttribute('data-variant') === 'e';   // true：文字が現れる／false：文字が燃えて消える

  // ---- 乱数（毎回同じ燃え方にするため、種を決めた物を使う） ----
  var seed = 20261115;
  function rand() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function hash(n) {                          // 点ごとに決まった値（0〜1）
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function noiseGrid(cols, rows) {           // なめらかな乱れ（0〜1）
    var g = []; for (var i = 0; i < (cols + 1) * (rows + 1); i++) g.push(rand());
    return function (u, v) {
      var x = u * cols, y = v * rows, x0 = Math.floor(x), y0 = Math.floor(y);
      x0 = Math.min(Math.max(x0, 0), cols - 1); y0 = Math.min(Math.max(y0, 0), rows - 1);
      var fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1); fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var a = g[y0 * (cols + 1) + x0], b = g[y0 * (cols + 1) + x0 + 1];
      var c = g[(y0 + 1) * (cols + 1) + x0], d = g[(y0 + 1) * (cols + 1) + x0 + 1];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
  }

  // ---- 時間の決まり（秒） ----
  // D：0.6秒で文字が出て、0.8秒で火が付き、2.7秒で燃え尽きて、4.3秒でトップへ
  // E：0.15秒から1.5秒かけて文字が現れ、少し見せて、2.5秒でトップへ
  var T = reveal ? { start: 0.15, run: 1.5, fadeStart: 2.0, end: 2.5 }
                 : { appear: 0.6, start: 0.8, run: 2.7, fadeStart: 3.6, end: 4.3 };

  // ---- 大きさ ----
  var W = 0, H = 0, dpr = 1;
  var logo = { x: 0, y: 0, w: 0, h: 0 };
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = overlay.clientWidth; H = overlay.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    logo.w = Math.min(W * 0.84, 520);
    logo.h = logo.w * logoImg.naturalHeight / logoImg.naturalWidth;
    logo.x = (W - logo.w) / 2; logo.y = H * 0.46 - logo.h / 2;
    prepare();
  }

  // ---- 炎がまわりをほんのり照らす光 ----
  var warm = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,120,40,0.55)'); gr.addColorStop(0.5, 'rgba(255,90,20,0.18)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return c;
  })();

  // ---- ロゴの絵 ----
  var logoImg = new Image(), ready = false;
  logoImg.onload = function () { ready = true; start(); };
  logoImg.onerror = function () { finish(); };
  logoImg.src = overlay.getAttribute('data-logo');

  // ---- 文字の各点が「いつ燃えるか」を決めておく ----
  // 文字は画面の細かさ（最大2倍）のまま持つので、細い線もくっきり。文字のある点だけを、燃える順に並べておき、
  // 毎コマ、燃えている帯の周りだけを描き直す（軽くするため）
  var B = null;
  var TMAX = 1.2, NB = 1024;
  function bucket(v) { return v <= 0 ? 0 : Math.min(NB - 1, Math.floor(v / TMAX * NB)); }
  var n1 = noiseGrid(6, 2), n2 = noiseGrid(24, 7), n3 = noiseGrid(80, 22);
  var c1 = noiseGrid(45, 12);   // 焦げた所がどこから崩れるか（まとまった穴になるように）
  var CREAM = [241, 232, 212], RED = [214, 40, 18];
  function prepare() {
    if (!ready) return;
    var lw = Math.max(1, Math.round(logo.w * dpr)), lh = Math.max(1, Math.round(logo.h * dpr));
    var c = document.createElement('canvas'); c.width = lw; c.height = lh;
    var cx = c.getContext('2d');
    cx.drawImage(logoImg, 0, 0, lw, lh);
    var src = cx.getImageData(0, 0, lw, lh), d = src.data;
    // 燃える順：D は下から上へ燃える（右側が少し先）。E は下から上へ現れる（左側が少し先）。
    // E は値の大きい所から現れるので、下ほど大きくする。いくつもの細かさの乱れで、縁を波打たせ、ぎざぎざに
    var n = 0, tmpI = new Uint32Array(lw * lh), tmpT = new Float32Array(lw * lh), tmpC = new Float32Array(lw * lh);
    var tMin = 1e9, tMax = -1e9;
    for (var y = 0; y < lh; y++) {
      for (var x = 0; x < lw; x++) {
        var i = (y * lw + x) * 4;
        if (d[i + 3] < 4) { d[i + 3] = 0; continue; }
        // 暗い背景に合わせて、墨はクリーム色に、赤（焼・牛の印の枠）は赤のまま
        var col = (d[i] > 110 && d[i + 1] < 90) ? RED : CREAM;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
        var u = x / lw, v = y / lh;
        tmpI[n] = i;
        var tv = 0.55 * (reveal ? v : 1 - v) + 0.2 * (1 - u) + 0.15 * n1(u, v) + 0.07 * n2(u, v) + 0.035 * n3(u, v);
        tmpT[n] = tv; if (tv < tMin) tMin = tv; if (tv > tMax) tMax = tv;
        tmpC[n] = 0.85 * c1(u, v) + 0.15 * hash(i);
        n++;
      }
    }
    // 火が付いた時から燃え始め、決めた時間で燃え尽きるように、0〜1にそろえる
    for (var m0 = 0; m0 < n; m0++) tmpT[m0] = clamp((tmpT[m0] - tMin) / Math.max(1e-6, tMax - tMin), 0, 1);
    var bstart = new Uint32Array(NB + 1), pos = new Uint32Array(NB);
    for (var m = 0; m < n; m++) bstart[bucket(tmpT[m]) + 1]++;
    for (var q = 0; q < NB; q++) { bstart[q + 1] += bstart[q]; pos[q] = bstart[q]; }
    var idx = new Uint32Array(n), th = new Float32Array(n), cr = new Float32Array(n);
    for (var m2 = 0; m2 < n; m2++) { var at = pos[bucket(tmpT[m2])]++; idx[at] = tmpI[m2]; th[at] = tmpT[m2]; cr[at] = tmpC[m2]; }
    var out = cx.createImageData(lw, lh);
    if (!reveal) out.data.set(d);
    // 燃える縁のまわりの、ごく弱い光（1/6の細かさで描いてぼかす）
    var gw = Math.max(1, Math.ceil(lw / 6)), gh = Math.max(1, Math.ceil(lh / 6));
    var glow = document.createElement('canvas'); glow.width = gw; glow.height = gh;
    var gx = glow.getContext('2d');
    B = { lw: lw, lh: lh, c: c, cx: cx, src: src, out: out, idx: idx, th: th, cr: cr, start: bstart, cleared: 0, restored: NB,
          glow: glow, gx: gx, gimg: gx.createImageData(gw, gh), gw: gw };
  }

  // 燃える縁のちらつき（となり同士はなめらかにつながり、時間とともに流れる）
  function flick(px, py, t) {
    return 0.5 + 0.3 * Math.sin(px * 0.19 + t * 11 + 2.2 * Math.sin(py * 0.23 - t * 6.3))
               + 0.2 * Math.sin(px * 0.053 - py * 0.09 + t * 4.1);
  }
  // 熱さ（0〜1）→ 色：暗い赤 → 赤橙 → 橙 → 黄みの白
  var HC = [[70, 10, 4], [190, 45, 10], [255, 115, 28], [255, 205, 130]];
  var hr = 0, hg = 0, hb = 0;
  function heatColor(h) {
    h = clamp(h, 0, 1) * 3; var k = Math.min(2, Math.floor(h)), f = h - k, a = HC[k], b = HC[k + 1];
    hr = a[0] + (b[0] - a[0]) * f; hg = a[1] + (b[1] - a[1]) * f; hb = a[2] + (b[2] - a[2]) * f;
  }

  var GLOW_OFF = [[0, 0], [-2, -1.5], [2, 1.5], [-1.5, 2], [1.5, -2]];
  // p：燃えた所の境目（D はだんだん増え、E はだんだん減るだけ）。戻り値：いま燃えている縁の点（灰・火の粉を出す所）
  function drawBurn(p, alpha, t) {
    var s = B.src.data, o = B.out.data, g = B.gimg.data, idx = B.idx, th = B.th, cr = B.cr, st = B.start;
    var EDGE = 0.012, CHAR = 0.1, SCORCH = 0.07;
    var lo = bucket(p - CHAR), hi = bucket(p + SCORCH);
    if (!reveal) {                                      // 燃え落ちた所は、一度だけ消す
      for (var k0 = st[B.cleared]; k0 < st[lo]; k0++) o[idx[k0] + 3] = 0;
      if (lo > B.cleared) B.cleared = lo;
    } else {                                            // 焼き上がった所は、一度だけ元の文字に戻す
      for (var k1 = st[hi + 1]; k1 < st[B.restored]; k1++) {
        var j = idx[k1]; o[j] = s[j]; o[j + 1] = s[j + 1]; o[j + 2] = s[j + 2]; o[j + 3] = s[j + 3];
      }
      if (hi + 1 < B.restored) B.restored = hi + 1;
    }
    g.fill(0);
    var front = [], lw = B.lw, gw = B.gw, fx = 0, fy = 0;
    for (var k = st[lo], kEnd = st[hi + 1]; k < kEnd; k++) {
      var i = idx[k], dd = th[k] - p, pi = i >> 2;
      var r = s[i], gr = s[i + 1], b = s[i + 2], a = s[i + 3];
      if (dd < -CHAR) {                                  // 燃え落ちた
        a = 0;
      } else if (dd < -EDGE) {                           // 黒く焦げ、穴があいて崩れ落ちていく
        var e = (-dd - EDGE) / (CHAR - EDGE), lim = 0.12 + 0.88 * cr[k];
        if (e > lim) {
          a = 0;
        } else if (e > lim - 0.09) {                     // 崩れる直前の穴の縁は、赤くくすぶる
          var fl = clamp(flick(pi % lw, (pi / lw) | 0, t), 0, 1);
          heatColor((0.18 + 0.32 * fl) * (1 - 0.6 * e)); r = hr; gr = hg; b = hb;
        } else {
          var tone = 44 - 14 * e + 8 * hash(pi);
          r = tone; gr = tone * 0.84; b = tone * 0.72;
          a = a * (1 - 0.25 * e);
        }
      } else if (dd < 0) {                               // 燃えている縁：先が明るく、後ろへ暗い赤に。場所ごとにちらつく
        var tt = -dd / EDGE, px = pi % lw, py = (pi / lw) | 0;
        var heat = (1 - tt) * clamp(0.35 + 0.75 * flick(px, py, t), 0, 1.1);
        heatColor(heat); r = hr; gr = hg; b = hb;
        var gi = (((py / 6) | 0) * gw + ((px / 6) | 0)) * 4;
        g[gi] = 255; g[gi + 1] = 105; g[gi + 2] = 25; g[gi + 3] = Math.min(255, g[gi + 3] + heat * 40);
        if (k % 17 === 0) { front.push(i); fx += px; fy += py; }
      } else if (dd < SCORCH) {                          // これから燃える所：茶色く焦げていく
        var c2 = Math.pow(1 - dd / SCORCH, 1.5);
        if (r > 200 && gr < 90) { r = r + (95 - r) * c2; gr = gr + (22 - gr) * c2; b = b + (8 - b) * c2; }
        else { r = r + (112 - r) * c2; gr = gr + (66 - gr) * c2; b = b + (32 - b) * c2; }
      }
      o[i] = r; o[i + 1] = gr; o[i + 2] = b; o[i + 3] = a;
    }
    B.cx.putImageData(B.out, 0, 0);
    B.gx.putImageData(B.gimg, 0, 0);
    // 炎がまわりをほんのり照らす（燃えている縁の真ん中あたり）
    if (front.length) {
      var cxp = logo.x + fx / front.length / dpr, cyp = logo.y + fy / front.length / dpr, R = Math.max(logo.h * 1.5, logo.w * 0.45);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.22 * Math.min(1, front.length / 25);
      ctx.drawImage(warm, cxp - R, cyp - R, R * 2, R * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    // 縁のまわりの、ごく弱い光（文字の後ろに置き、焦げの茶色を明るくしない）
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.12;
    for (var o2 = 0; o2 < GLOW_OFF.length; o2++) {
      ctx.drawImage(B.glow, logo.x + GLOW_OFF[o2][0], logo.y + GLOW_OFF[o2][1], logo.w, logo.h);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.drawImage(B.c, logo.x, logo.y, logo.w, logo.h);
    ctx.globalAlpha = 1;
    return front;
  }

  // ---- 粒：灰（光ってから冷めて灰色に）と、細い火の粉 ----
  var parts = [];
  function add(k, x, y) {
    var p = { k: k, x: x, y: y, life: 0, ph: rand() * 6.28, rot: rand() * 6.28, vr: (rand() - 0.5) * 5 };
    if (k === 'spark') {
      p.vx = (rand() - 0.5) * 70; p.vy = -(70 + rand() * 130); p.max = 0.3 + rand() * 0.5; p.s = 0.6 + rand() * 0.7;
    } else {
      p.vx = (rand() - 0.5) * 22; p.vy = -(16 + rand() * 38); p.max = 1.3 + rand() * 1.6; p.s = 1.1 + rand() * 2.3;
      p.hot = 0.08 + rand() * 0.22;
      var sh = (62 + rand() * 46) | 0; p.shade = 'rgb(' + sh + ',' + ((sh * 0.93) | 0) + ',' + ((sh * 0.86) | 0) + ')';
    }
    parts.push(p);
  }
  function stepParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.rot += p.vr * dt;
      if (p.k === 'spark') {
        p.ph += dt * 24;
        p.vy += 70 * dt; p.vx *= (1 - 1.2 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else {
        p.ph += dt * 2.2;
        p.x += (p.vx + Math.sin(p.ph) * 16) * dt; p.y += p.vy * dt;
        p.vy *= (1 - 0.25 * dt);
      }
    }
  }
  function drawParts() {
    for (var j = 0; j < parts.length; j++) {
      var a = parts[j]; if (a.k !== 'ash') continue;
      var ra = a.life / a.max;
      var c = Math.cos(a.rot), s = Math.sin(a.rot), sz = a.s * (1 - ra * 0.35);
      var fl = 0.2 + 0.8 * Math.abs(Math.cos(a.ph * 1.4));            // ひらひら裏返る
      ctx.setTransform(dpr * c, dpr * s, -dpr * s * fl, dpr * c * fl, a.x * dpr, a.y * dpr);
      ctx.globalAlpha = Math.pow(1 - ra, 1.2) * 0.85;
      ctx.fillStyle = a.life < a.hot ? '#e2742f' : a.life < a.hot * 2 ? '#6e3219' : a.shade;
      ctx.beginPath();                                                // ふぞろいな小片
      ctx.moveTo(-sz * 0.5, -sz * 0.2); ctx.lineTo(sz * 0.1, -sz * 0.5);
      ctx.lineTo(sz * 0.5, sz * 0.15); ctx.lineTo(-sz * 0.15, sz * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var k = 0; k < parts.length; k++) {
      var q = parts[k]; if (q.k !== 'spark') continue;
      var rq = q.life / q.max;
      ctx.globalAlpha = (1 - rq) * (0.55 + 0.45 * Math.sin(q.ph));
      ctx.strokeStyle = rq < 0.4 ? '#ffd08a' : '#ff8a3a';
      ctx.lineWidth = q.s;
      ctx.beginPath();                                                // 速さの向きに短く尾を引く
      ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- 1コマ ----
  var t = 0, done = false, skipping = false;
  function frame(dt) {
    t += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (ready && B) {
      var appear = reveal ? 1 : smooth(0, T.appear, t);
      var bt = clamp((t - T.start) / T.run, 0, 1);
      var ease = 0.75 * bt + 0.25 * (0.5 - 0.5 * Math.cos(Math.PI * bt));
      var p = reveal ? 1.12 - 1.19 * ease : -0.07 + 1.19 * ease;
      var front = drawBurn(p, appear, t);
      if (front.length) {
        var lw = B.lw, rate = dt * 60;
        for (var q = 0; q < Math.round((reveal ? 1.6 : 2.4) * rate); q++) {
          var fi = front[Math.floor(rand() * front.length)] >> 2;
          var fx = logo.x + (fi % lw) / dpr, fy = logo.y + ((fi / lw) | 0) / dpr;
          add(rand() < 0.72 ? 'ash' : 'spark', fx, fy);
        }
      }
    }
    stepParts(dt); drawParts();
    if (!skipping) {
      var fade = smooth(T.fadeStart, T.end, t);
      overlay.style.opacity = String(1 - fade);
      if (fade >= 1) finish();
    }
  }

  // ---- 動かす ----
  var last = 0, raf = 0;
  function loop(now) {
    if (done) return;
    var dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    frame(dt);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    layout();
    if (capture) return;
    raf = requestAnimationFrame(loop);
  }
  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    root.classList.remove('has-intro');
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  // 押したら、描くのが重い端末でも、本物の時間で0.35秒で消す
  function skip() {
    if (skipping || done) return;
    skipping = true;
    overlay.style.transition = 'opacity .35s ease';
    overlay.style.opacity = '0';
    setTimeout(finish, 380);
  }
  overlay.addEventListener('click', skip);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') skip(); });
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (done || !ready) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);           // 作り直しは重いので、大きさが落ち着いてから
  });
  // 万一、絵が読めない・端末が遅くて終わらない時も、9秒で外す
  if (!capture) setTimeout(finish, 9000);

  window.__intro = { step: function (dt) { if (!done && ready) frame(dt); return { t: t, done: done }; }, ready: function () { return ready && !!B; } };
})();
