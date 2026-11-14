/*  Шапка: поведение 1-в-1 как на index.html  */
(() => {
  'use strict';

  const topbar = document.getElementById('topbar');
  const navLinks = document.getElementById('navLinks');
  const menuToggle = document.getElementById('menuToggle');

  /* Уплотнение шапки при скролле */
  const onScroll = () => {
    if (topbar) topbar.classList.toggle('scrolled', window.scrollY > 10);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Бургер-меню (≤425px) */
  const setMenu = (open) => {
    if (!navLinks || !menuToggle) return;
    navLinks.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu(!navLinks.classList.contains('open'));
    });
    navLinks.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => setMenu(false))
    );
    document.addEventListener('click', (e) => {
      if (!navLinks.contains(e.target) && e.target !== menuToggle) setMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 425) setMenu(false);
    }, { passive: true });
  }
})();

/* ================= Дашборд: сцена Three.js + UI ================= */
/* Планеты берутся из planets.json (заглушка БД). Позже — fetch('/api/v1/planets/'). */
window.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const app = document.getElementById('app');
  if (!app || !window.THREE) return;
  const $ = (id) => document.getElementById(id);
  const T = THREE;

  let planets = [];
  try { planets = (await (await fetch(app.dataset.planets)).json()).data; }
  catch (e) { console.error('Не удалось загрузить planets.json', e); return; }
  planets.sort((a, b) => b.esi_score - a.esi_score).forEach((p, i) => (p.rank = i + 1)); // место по ESI — всегда честное

  /* ---------- процедурные текстуры (3D-моделей нет — генерируем по данным) ---------- */
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = (a) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const mkNoise = (r) => {
    const P = new Float32Array(65536); for (let i = 0; i < 65536; i++) P[i] = r();
    return (x, y, px) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const g = (a, b) => P[((b & 255) << 8) | (((a % px) + px) % px)];
      return (g(xi, yi) * (1 - u) + g(xi + 1, yi) * u) * (1 - v) + (g(xi, yi + 1) * (1 - u) + g(xi + 1, yi + 1) * u) * v;
    };
  };
  const fbm = (n, u, v, sx, sy, o) => { let a = .5, f = 1, t = 0; for (let i = 0; i < o; i++) { t += a * n(u * sx * f, v * sy * f, sx * f); a /= 2; f *= 2; } return t / .97; };
  const mix = (a, b, t) => { t = Math.max(0, Math.min(1, t)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };

  const kindOf = (p) => p.pl_rade > 6 ? 'gas' : p.pl_rade >= 2.2 ? 'ice' : p.pl_eqt > 1000 ? 'lava' : p.esi_score > .6 ? 'ocean' : 'barren';
  const KIND = { gas: 'газовый гигант', ice: 'ледяной нептуноподобный мир', lava: 'раскалённая каменная планета', ocean: 'каменистая планета с умеренным климатом', barren: 'холодный каменистый мир' };
  const ATM = { gas: [.5, .7, 1], ice: [.5, .75, 1], lava: [1, .45, .15], ocean: [.4, .65, 1], barren: [.7, .6, .55] };

  const palette = (p, k) => {
    if (k === 'gas') return p.pl_eqt > 1500 ? [[48, 22, 36], [236, 128, 72], [150, 70, 52]] : p.pl_eqt > 800 ? [[196, 158, 108], [142, 96, 58], [236, 212, 172]] : [[52, 104, 168], [140, 182, 218], [28, 58, 108]];
    if (k === 'ice') return p.pl_eqt > 500 ? [[120, 90, 150], [200, 160, 190], [70, 50, 100]] : [[40, 90, 170], [120, 175, 230], [20, 50, 120]];
    return null;
  };

  const makeTex = (p, W = 512, H = 256) => {
    const k = kindOf(p), n = mkNoise(rng(hash(p.name))), pal = palette(p, k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H; let col;
      if (k === 'gas' || k === 'ice') {
        const bands = k === 'gas' ? 9 : 3, w = fbm(n, u, v, 3, 3, 3) * (k === 'gas' ? 1.5 : .5);
        const t = Math.sin((v * bands + w) * Math.PI) * .5 + .5;
        col = mix(mix(pal[0], pal[1], t), pal[2], (fbm(n, u + .3, v, 6, 24, 3) - .45) * 1.6);
      } else if (k === 'ocean') {
        const h = fbm(n, u, v, 4, 4, 5), pole = Math.abs(v - .5) * 2;
        if (h < .5) col = mix([8, 30, 80], [40, 110, 170], h / .5);
        else { const t = (h - .5) / .5; col = t > .55 ? [235, 240, 245] : mix([50, 110, 55], [140, 110, 70], t * 2); }
        if (pole > .88 + n(u * 40, 3, 40) * .05) col = [240, 245, 250];
        col = mix(col, [255, 255, 255], (fbm(n, u + .5, v, 6, 8, 4) - .55) * 3.2);
      } else if (k === 'lava') {
        const h = fbm(n, u, v, 4, 4, 5), cr = Math.abs(h - .5);
        col = mix([30, 20, 18], [70, 48, 40], fbm(n, u, v, 8, 8, 3));
        if (cr < .04) col = mix(col, [255, 120, 30], 1 - cr / .04);
      } else {
        const h = fbm(n, u, v, 5, 5, 5), s = .75 + .5 * fbm(n, u + .2, v, 16, 16, 3);
        col = mix([84, 76, 70], [168, 152, 134], h).map((q) => q * s);
      }
      const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0); return c;
  };

  /* ---------- сцена ---------- */
  const stage = $('stage');
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, 1, .1, 200);
  cam.position.z = 6.2;

  const stars = (() => { // звёзды на фоне
    const N = 1800, a = new Float32Array(N * 3), r = rng(7);
    for (let i = 0; i < N; i++) { const th = r() * 6.283, ph = Math.acos(2 * r() - 1), R = 60; a[i * 3] = R * Math.sin(ph) * Math.cos(th); a[i * 3 + 1] = R * Math.cos(ph); a[i * 3 + 2] = R * Math.sin(ph) * Math.sin(th); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(a, 3));
    const pts = new T.Points(geo, new T.PointsMaterial({ color: 0xffffff, size: .18, transparent: true, opacity: .8, sizeAttenuation: true }));
    scene.add(pts); return pts;
  })();

  const sunLight = new T.DirectionalLight(0xfff2dc, 2.4); sunLight.position.set(-7, 1.5, 4); // свет слева, правая сторона в тени
  scene.add(sunLight, new T.AmbientLight(0x1a2236, .9));

  // планета
  const tilt = new T.Group(), root = new T.Group(); root.add(tilt); scene.add(root);
  const mat = new T.MeshStandardMaterial({ roughness: .95, metalness: 0, transparent: true });
  const mesh = new T.Mesh(new T.SphereGeometry(1, 72, 54), mat);
  const atmU = { col: { value: new T.Color(1, 1, 1) }, op: { value: 0 } };
  const atm = new T.Mesh(new T.SphereGeometry(1.07, 48, 36), new T.ShaderMaterial({
    uniforms: atmU, transparent: true, side: T.BackSide, blending: T.AdditiveBlending, depthWrite: false,
    vertexShader: 'varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 col;uniform float op;varying vec3 n;void main(){float i=pow(max(.62-dot(n,vec3(0,0,1)),0.),3.);gl_FragColor=vec4(col*i*2.2*op,i*op);}',
  }));
  tilt.add(mesh, atm); tilt.rotation.z = .3; root.visible = false;

  // солнце-вступление
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(.3, 'rgba(255,190,100,.55)'); r.addColorStop(1, 'rgba(255,150,50,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); return new T.CanvasTexture(c); })();
  const sunG = new T.Group();
  const sunMesh = new T.Mesh(new T.SphereGeometry(1.4, 64, 48), new T.MeshBasicMaterial({ map: new T.CanvasTexture((() => {
    const n = mkNoise(rng(99)), c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'), im = g.createImageData(512, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) { const col = mix([255, 150, 50], [255, 244, 190], fbm(n, x / 512, y / 256, 5, 5, 5) * 1.4 - .15), i = (y * 512 + x) * 4; im.data.set([col[0], col[1], col[2], 255], i); }
    g.putImageData(im, 0, 0); return c;
  })()) }));
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
  glow.scale.setScalar(10); sunG.add(sunMesh, glow); sunG.position.y = -4.5; scene.add(sunG);

  /* ---------- раскладка / рендер ---------- */
  const layout = () => {
    const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    const wide = w > 900; root.position.set(wide ? -1.25 : 0, wide ? 0 : .9, 0);
  };
  addEventListener('resize', layout); layout();

  let drag = null, vel = .0035;
  const loop = () => {
    requestAnimationFrame(loop);
    mesh.rotation.y += vel; vel += (.0016 - vel) * .03; sunMesh.rotation.y += .0007; stars.rotation.y += .00006;
    renderer.render(scene, cam);
  };
  loop();

  // вращение мышью/пальцем — планету можно осмотреть
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, m: 0 }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.m += Math.abs(dx) + Math.abs(dy);
    mesh.rotation.y += dx * .007; vel = dx * .0007; tilt.rotation.x = Math.max(-.7, Math.min(.7, tilt.rotation.x + dy * .004));
  });
  const ray = new T.Raycaster();
  stage.addEventListener('pointerup', (e) => { // клик по планете → боковое меню
    const moved = drag && drag.m > 5; drag = null; if (moved || !root.visible) return;
    const r = stage.getBoundingClientRect(); ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
    if (ray.intersectObject(mesh).length) toggleDrawer();
  });

  /* ---------- UI ---------- */
  const tween = (ms, f) => new Promise((res) => { const t0 = performance.now(); const s = (t) => { const k = Math.min(1, (t - t0) / ms); f(k); k < 1 ? requestAnimationFrame(s) : res(); }; requestAnimationFrame(s); });
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const fx = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d).replace(/\.?0+$/, ''));
  const grav = (p) => p.pl_bmasse / (p.pl_rade * p.pl_rade);
  const scaleOf = (p) => Math.max(.7, Math.min(1.35, .85 + .4 * Math.log10(p.pl_rade)));
  const descOf = (p) => {
    const k = kindOf(p), t = p.pl_eqt;
    return [
      `${p.name} — ${KIND[k]}, обращается вокруг звезды класса ${p.st_spectype}. Радиус в ${fx(p.pl_rade)} раз ${p.pl_rade >= 1 ? 'больше' : 'меньше'} земного, масса — ${fx(p.pl_bmasse)} масс Земли.`,
      `Равновесная температура около ${t} K (${Math.round(t - 273)} °C). ${p.esi_score > .8 ? 'Одна из самых земноподобных планет каталога.' : p.esi_score > .5 ? 'Условия лишь отдалённо напоминают земные.' : 'Для привычной нам жизни непригодна.'}`,
    ];
  };
  const shortDesc = (p) => `${KIND[kindOf(p)]} · ${p.pl_eqt} K`;

  let cur = -1, busy = false, live = false, sortK = 'esi_score', sortDir = -1;
  const rows = (p) => [['Радиус', `${fx(p.pl_rade)} R⊕`], ['Орб. период', `${fx(p.pl_orbper)} дн.`], ['Большая полуось', `${fx(p.pl_orbsmax, 3)} а.е.`], ['Гравитация', `${fx(grav(p))} g`], ['Темп. равновесная', `${p.pl_eqt} K`], ['Индекс ESI', `${fx(p.esi_score, 3)} · №${p.rank}`]];

  const fillText = (p) => {
    $('stats').innerHTML = rows(p).map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    $('cName').textContent = p.name.toUpperCase(); const [a, b] = descOf(p); $('cD1').textContent = a; $('cD2').textContent = b;
  };
  const fillDrawer = (p) => {
    $('dName').textContent = p.name;
    const r = [['Тип', KIND[kindOf(p)]], ['Звезда', p.st_spectype], ['Масса', `${fx(p.pl_bmasse)} M⊕`], ['Плотность (отн.)', fx(p.pl_dens)], ['Скорость убегания', `${fx(p.v_esc * 11.186, 1)} км/с`], ['Каменистая', p.is_rocky ? 'да' : 'нет'], ['Качество данных', p.data_grade], ...rows(p)];
    $('dData').innerHTML = r.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  };
  const toggleDrawer = (open) => { const d = $('drawer'); d.classList.toggle('open', open ?? !d.classList.contains('open')); };

  const texCache = {};
  const go = async (i, openDrawer) => {
    if (!live || busy) return;
    if (i === cur) { if (openDrawer) toggleDrawer(); return; }
    busy = true; const p = planets[i], first = cur < 0; cur = i;
    app.classList.add('swap'); markActive();
    const s0 = root.scale.x;
    if (!first) await tween(380, (k) => { const e = ease(k); root.scale.setScalar(s0 * (1 - .22 * e)); mat.opacity = 1 - e; atmU.op.value = 1 - e; });
    const tex = texCache[p.id] || (texCache[p.id] = new T.CanvasTexture(makeTex(p))); tex.anisotropy = 4;
    mat.map = tex; mat.needsUpdate = true; atmU.col.value.setRGB(...ATM[kindOf(p)]);
    fillText(p); if ($('drawer').classList.contains('open') || openDrawer) { fillDrawer(p); toggleDrawer(true); }
    root.visible = true; const sc = scaleOf(p); vel = .02;
    await tween(900, (k) => { const e = ease(k); root.scale.setScalar(sc * (.78 + .22 * e)); mat.opacity = e; atmU.op.value = e; });
    app.classList.remove('swap'); busy = false;
  };

  /* правая панель */
  const thumb = (p) => {
    const c = document.createElement('canvas'); c.width = c.height = 80; const g = c.getContext('2d'); g.save(); g.beginPath(); g.arc(40, 40, 40, 0, 7); g.clip();
    g.drawImage(makeTex(p, 128, 64), 0, 0, 160, 80); const sh = g.createRadialGradient(26, 30, 6, 40, 40, 44); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.75)'); g.fillStyle = sh; g.fillRect(0, 0, 80, 80); g.restore(); return c;
  };
  const list = $('list');
  list.innerHTML = '';
  planets.forEach((p, i) => {
    const li = document.createElement('li'); li.dataset.i = i;
    li.innerHTML = `<div class="th"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="24"/></svg></div><div><div class="nm">${p.name}</div><div class="ds">${shortDesc(p)}</div></div><div class="rk">ESI<b>#${p.rank}</b></div>`;
    li.querySelector('.th').prepend(thumb(p)); li.onclick = () => go(i, true); list.appendChild(li);
  });
  const resort = () => {
    const items = [...list.children].sort((a, b) => sortDir * (planets[a.dataset.i][sortK] - planets[b.dataset.i][sortK]));
    items.forEach((li) => list.appendChild(li));
  };
  $('sorts').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sortDir = b.dataset.k === sortK ? -sortDir : -1; sortK = b.dataset.k;
    [...$('sorts').children].forEach((x) => x.classList.toggle('on', x === b)); resort();
  };
  $('railMin').onclick = () => $('rail').classList.add('min');
  $('railOpen').onclick = () => $('rail').classList.remove('min');
  $('dClose').onclick = () => toggleDrawer(false);

  /* карусель-точки */
  const dots = $('dots');
  const markActive = () => {
    const s = Math.max(0, Math.min(planets.length - 9, cur - 4));
    dots.innerHTML = '';
    planets.slice(s, s + 9).forEach((p, k) => {
      const b = document.createElement('button'); b.className = s + k === cur ? 'on' : ''; b.innerHTML = `<i></i><span>${p.name}</span>`; b.onclick = () => go(s + k); dots.appendChild(b);
    });
    [...list.children].forEach((li) => li.classList.toggle('on', +li.dataset.i === cur));
  };
  addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(Math.min(cur + 1, planets.length - 1)); if (e.key === 'ArrowLeft') go(Math.max(cur - 1, 0)); });

  /* ---------- вступление: солнце поднимается, затем — вспышка и первая планета ---------- */
  const intro = $('intro'), flash = $('flash'); intro.style.opacity = 0;
  setTimeout(() => (intro.style.opacity = 1), 900);
  await tween(3600, (k) => { const e = ease(k); sunG.position.y = -4.5 + 4.5 * e; sunG.scale.setScalar(1.8 - .8 * e); sunLight.intensity = 2.4; });
  await new Promise((r) => setTimeout(r, 1000));
  flash.style.transition = 'opacity .7s'; flash.style.opacity = 1; await new Promise((r) => setTimeout(r, 750));
  scene.remove(sunG); intro.style.opacity = 0; // вернуться к солнцу нельзя (заглушка)
  live = true; app.classList.add('live'); flash.style.transition = 'opacity 1.4s'; flash.style.opacity = 0;
  go(0);
});
