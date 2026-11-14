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

  const texJob = (p, W, H, cloud) => {
    const k = kindOf(p), n = mkNoise(rng(hash(p.name) + (cloud ? 7 : 0))), pal = palette(p, k), hi = W > 600 ? 1 : 0;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data; let y = 0;
    const surf = (u, v) => {
      if (k === 'gas' || k === 'ice') {
        const bands = k === 'gas' ? 9 : 3, w = fbm(n, u, v, 3, 3, 3 + hi) * (k === 'gas' ? 1.5 : .5);
        const t = Math.sin((v * bands + w) * Math.PI) * .5 + .5;
        return mix(mix(pal[0], pal[1], t), pal[2], (fbm(n, u + .3, v, 6, 24, 3 + hi) - .45) * 1.6);
      }
      if (k === 'ocean') {
        const h = fbm(n, u, v, 4, 4, 5 + hi), pole = Math.abs(v - .5) * 2; let col;
        if (h < .5) col = mix([6, 26, 74], [44, 122, 178], h / .5 + (h > .46 ? (h - .46) * 8 : 0));
        else { const t = (h - .5) / .5, m = fbm(n, u + .7, v, 6, 6, 3 + hi); col = mix(mix([42, 100, 50], [196, 168, 108], (m - .35) * 3), [120, 100, 82], t * 1.5); if (t > .6) col = [238, 242, 247]; }
        if (pole > .88 + n(u * 40, 3, 40) * .05) col = [240, 245, 250];
        return col;
      }
      if (k === 'lava') {
        const h = fbm(n, u, v, 4, 4, 5 + hi), cr = Math.abs(h - .5); let col = mix([30, 20, 18], [74, 50, 42], fbm(n, u, v, 8, 8, 3 + hi));
        if (cr < .04) col = mix(col, [255, 120, 30], 1 - cr / .04); return col;
      }
      const h = fbm(n, u, v, 5, 5, 5 + hi), s2 = .75 + .5 * fbm(n, u + .2, v, 16, 16, 3 + hi);
      return mix([84, 76, 70], [168, 152, 134], h).map((q) => q * s2);
    };
    const clouds = (u, v) => {
      const f = fbm(n, u, v, 5, 6, 4 + hi), s2 = fbm(n, u + .2, v, 3, 12, 3), dens = k === 'ocean' ? .5 : k === 'lava' ? .58 : .55;
      const a = Math.max(0, Math.min(1, (f * .85 + s2 * .15 - dens) * 5)), col = k === 'lava' ? [58, 44, 40] : k === 'ice' ? [225, 238, 255] : [255, 255, 255];
      return [col[0], col[1], col[2], a * (k === 'lava' ? 210 : 255)];
    };
    return { canvas: c, step(rows) {
      const e = Math.min(H, y + rows);
      for (; y < e; y++) for (let x = 0; x < W; x++) { const col = cloud ? clouds(x / W, y / H) : surf(x / W, y / H), i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col.length > 3 ? col[3] : 255; }
      if (y >= H) { g.putImageData(im, 0, 0); return true; } return false;
    } };
  };
  const makeTex = (p, W = 512, H = 256, cloud) => { const j = texJob(p, W, H, cloud); j.step(H); return j.canvas; };

  /* ---------- сцена ---------- */
  const stage = $('stage');
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, 1, .1, 200);
  cam.position.z = 6.2;

  const starU = { t: { value: 0 }, px: { value: Math.min(devicePixelRatio, 2) } };
  const stars = (() => { // мерцающие звёзды: статичны, двигаются только когда мы вращаем планету
    const N = 2600, pos = new Float32Array(N * 3), siz = new Float32Array(N), ph = new Float32Array(N), r = rng(7);
    for (let i = 0; i < N; i++) {
      const th = r() * 6.283, f = Math.acos(2 * r() - 1), R = 60;
      pos[i * 3] = R * Math.sin(f) * Math.cos(th); pos[i * 3 + 1] = R * Math.cos(f); pos[i * 3 + 2] = R * Math.sin(f) * Math.sin(th);
      siz[i] = r() < .06 ? 8 + r() * 6 : 3 + r() * 4; ph[i] = r();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('size', new T.BufferAttribute(siz, 1)); geo.setAttribute('phase', new T.BufferAttribute(ph, 1));
    const pts = new T.Points(geo, new T.ShaderMaterial({
      uniforms: starU, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'attribute float size;attribute float phase;uniform float t;uniform float px;varying float a;void main(){a=.55+.45*sin(t*(1.2+phase*1.8)+phase*40.);gl_PointSize=size*px*(.8+.4*a);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying float a;void main(){float d=length(gl_PointCoord-.5)*2.;float g=max(1.-d,0.);gl_FragColor=vec4(vec3(1.),min((pow(g,2.2)+.9*pow(g,8.))*a*1.5,1.));}',
    }));
    pts.frustumCulled = false; scene.add(pts); return pts;
  })();

  const sunLight = new T.DirectionalLight(0xfff2dc, 2.4); sunLight.position.set(-7, 1.5, 4); // солнце стоит на месте в мире
  const fill = new T.DirectionalLight(0x4a5f9a, .35); fill.position.set(6, -1, -4); // слабая подсветка ночной стороны
  scene.add(sunLight, fill, new T.AmbientLight(0x3d4a6e, 1.15));

  // планета: поверхность + облака + два слоя атмосферы
  const tilt = new T.Group(), root = new T.Group(); root.add(tilt); scene.add(root);
  const mat = new T.MeshStandardMaterial({ roughness: .95, metalness: 0, transparent: true });
  const mesh = new T.Mesh(new T.SphereGeometry(1, 96, 72), mat);
  const cloudMat = new T.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  const cloud = new T.Mesh(new T.SphereGeometry(1.018, 96, 72), cloudMat); cloud.renderOrder = 1;
  const atmU = { col: { value: new T.Color(1, 1, 1) }, op: { value: 0 }, sun: { value: new T.Vector3(-1, 0, 0) } };
  const aHead = 'uniform vec3 col;uniform float op;uniform vec3 sun;varying vec3 n;';
  const aSun = 'float sd=dot(vec3(0.,0.,1.),sun);float s=(.1+.9*smoothstep(-.35,.85,dot(normalize(n),sun)))*(.55+.7*smoothstep(-.2,.9,sd));'; // глоу сильнее со стороны солнца
  const mkAtm = (rad, side, fs, order) => { const m = new T.Mesh(new T.SphereGeometry(rad, 64, 48), new T.ShaderMaterial({ uniforms: atmU, transparent: true, side, blending: T.AdditiveBlending, depthWrite: false, vertexShader: 'varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: aHead + fs })); m.renderOrder = order; return m; };
  const atmIn = mkAtm(1.024, T.FrontSide, 'void main(){float f=pow(1.-max(dot(normalize(n),vec3(0.,0.,1.)),0.),3.5);' + aSun + 'gl_FragColor=vec4(col*f*1.3*s*op,f*.8*s*op);}', 2);
  const atmOut = mkAtm(1.15, T.BackSide, 'void main(){float f=pow(max(.62-dot(n,vec3(0.,0.,1.)),0.),3.);' + aSun + 'gl_FragColor=vec4(col*f*2.4*s*op,f*s*op);}', 3);
  tilt.add(mesh, cloud, atmIn, atmOut); tilt.rotation.z = .3; root.visible = false;

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
  const layout = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', layout); layout();

  let vel = .0016, zoomT = 6.2, dist = 6.2, yaw = 0, pitch = 0, yv = 0, pv = 0, uiLast = -1, hov = false, drag = null, pd = 0;
  const drift = { x: 0, y: 0 }, dv = { x: 0, y: 0 }, sh = { x: 0, y: 0 }, ptrs = new Map(), railEl = $('rail');
  const clampZ = (z) => Math.max(2.4, Math.min(9, z)), c01 = (x) => Math.max(0, Math.min(1, x));
  stars.rotation.order = 'YXZ';
  const sunDir = sunLight.position.clone().normalize(), sunV = new T.Vector3();
  const ring = (() => { // контур при наведении на планету
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 3; g.shadowColor = '#fff'; g.shadowBlur = 14; g.beginPath(); g.arc(256, 256, 240, 0, 7); g.stroke();
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, opacity: 0, depthTest: false })); sp.renderOrder = 10; scene.add(sp); return sp;
  })();
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  const pick = (e) => { const r = stage.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); return root.visible && ray.intersectObject(mesh).length > 0; };

  const loop = () => {
    requestAnimationFrame(loop);
    starU.t.value = performance.now() / 1000;
    mesh.rotation.y += vel; cloud.rotation.y += vel * .35; vel += (.0016 - vel) * .03; sunMesh.rotation.y += .0007; // собственное вращение планеты
    if (!ptrs.size) { yaw += yv; pitch = Math.max(-1.25, Math.min(1.25, pitch + pv)); yv *= .92; pv *= .92; drift.x += dv.x; drift.y += dv.y; dv.x *= .93; dv.y *= .93; }
    dist += (zoomT - dist) * .12;
    // камера летает вокруг планеты, солнце остаётся на месте → видно дневную и ночную стороны
    cam.position.set(dist * Math.sin(yaw) * Math.cos(pitch), dist * Math.sin(pitch), dist * Math.cos(yaw) * Math.cos(pitch)); cam.lookAt(0, 0, 0);
    stars.rotation.y = yaw + drift.y; stars.rotation.x = -pitch + drift.x; // звёзды стоят, а при вращении слегка идут вслед
    // смещение планеты влево от центра; при приближении — плавно в центр свободной области
    const w = stage.clientWidth, h = stage.clientHeight, wide = w > 900, kz = c01((dist - 2.4) / 3.8), on = app.classList.contains('live');
    const rw = !railEl.classList.contains('min') && w > 650 ? railEl.offsetWidth : 0;
    const tx = on ? (wide ? .14 * w : 0) * kz + rw * .5 * (1 - kz) : 0, ty = on && !wide ? .2 * h * kz : 0;
    sh.x += (tx - sh.x) * .1; sh.y += (ty - sh.y) * .1; cam.setViewOffset(w, h, sh.x, sh.y, w, h);
    cam.updateMatrixWorld(); sunV.copy(sunDir).transformDirection(cam.matrixWorldInverse); atmU.sun.value.copy(sunV);
    const ui = .12 + .88 * c01((dist - 3.2) / 2.4); // ближе к планете — интерфейс прозрачнее
    if (Math.abs(ui - uiLast) > .01) { app.style.setProperty('--ui', ui.toFixed(2)); uiLast = ui; }
    const sc = root.scale.x, rr = sc * dist / Math.sqrt(Math.max(dist * dist - sc * sc, .01));
    ring.scale.setScalar(2 * rr * 1.045 * 256 / 240); ring.material.opacity += ((hov ? 1 : 0) - ring.material.opacity) * .2;
    renderer.render(scene, cam);
  };
  loop();

  // вращение (мышь/палец), приближение (колесо/щипок), наведение и клик
  stage.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = drag || { m: 0 }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    const q = ptrs.get(e.pointerId);
    if (!q) { const hh = pick(e); if (hh !== hov) { hov = hh; stage.style.cursor = hh ? 'pointer' : ''; } return; }
    const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY; drag.m += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y); if (pd) zoomT = clampZ(zoomT * pd / dd); pd = dd; drag.m += 99; return; }
    yaw -= dx * .006; pitch = Math.max(-1.25, Math.min(1.25, pitch + dy * .005)); yv = -dx * .0012; pv = dy * .001;
    drift.y -= dx * .0012; drift.x -= dy * .0012; dv.y = -dx * .0004; dv.x = -dy * .0004;
  });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomT = clampZ(zoomT * Math.exp(e.deltaY * .0012)); }, { passive: false });
  const end = (e) => {
    ptrs.delete(e.pointerId); pd = 0;
    if (!ptrs.size) { const moved = drag && drag.m > 5; drag = null; if (!moved && e.type === 'pointerup' && pick(e)) toggleDrawer(); }
  };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);

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
    $('cName').textContent = p.name.toUpperCase(); const [a, b] = descOf(p); $('cD1').textContent = a; $('cD2').textContent = b;
  };
  const fillDrawer = (p) => {
    $('dName').textContent = p.name; const dc = $('dThumb').getContext('2d'); dc.clearRect(0, 0, 192, 192); dc.drawImage(thumb(p, 192), 0, 0);
    const r = [['Тип', KIND[kindOf(p)]], ['Звезда', p.st_spectype], ['Масса', `${fx(p.pl_bmasse)} M⊕`], ['Плотность (отн.)', fx(p.pl_dens)], ['Скорость убегания', `${fx(p.v_esc * 11.186, 1)} км/с`], ['Каменистая', p.is_rocky ? 'да' : 'нет'], ['Качество данных', p.data_grade], ...rows(p)];
    $('dData').innerHTML = r.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  };
  const toggleDrawer = (open) => { // данные открываются прямо в правой панели вместо списка
    const r = $('rail'), on = open ?? !r.classList.contains('detail'); if (on && cur < 0) return;
    r.classList.toggle('detail', on); if (on) { r.classList.remove('min'); fillDrawer(planets[cur]); }
  };

  const cache = {}, hiList = [], frame = () => new Promise(requestAnimationFrame), maxA = renderer.capabilities.getMaxAnisotropy();
  const mk = (cv) => { const t = new T.CanvasTexture(cv); t.anisotropy = maxA; return t; };
  const BUMP = { barren: .06, lava: .06, ocean: .02, gas: 0, ice: 0 }, CLOUDY = { ocean: 1, lava: 1, ice: 1 };
  const show = (p, sf, cl) => { const k = kindOf(p); mat.map = sf; mat.bumpMap = sf; mat.bumpScale = BUMP[k]; mat.needsUpdate = true; cloud.visible = !!CLOUDY[k]; cloudMat.map = cl; cloudMat.needsUpdate = true; };
  const upgrade = async (p, e) => { // чёткая текстура 2048×1024 считается кусками, без подвисаний
    e.busy = true; const k = kindOf(p), js = texJob(p, 2048, 1024), jc = CLOUDY[k] ? texJob(p, 1024, 512, true) : null;
    while (!js.step(36)) { await frame(); if (planets[cur] !== p) { e.busy = false; return; } }
    if (jc) while (!jc.step(40)) { await frame(); if (planets[cur] !== p) { e.busy = false; return; } }
    e.hi = { s: mk(js.canvas), c: jc ? mk(jc.canvas) : null }; e.busy = false; hiList.push(e);
    while (hiList.length > 3) { const o = hiList.shift(); if (o.hi) { o.hi.s.dispose(); o.hi.c && o.hi.c.dispose(); o.hi = null; } }
    if (planets[cur] === p) show(p, e.hi.s, e.hi.c);
  };
  const setPlanetTex = (p) => {
    const k = kindOf(p), e = cache[p.id] || (cache[p.id] = { lo: { s: mk(makeTex(p, 512, 256)), c: CLOUDY[k] ? mk(makeTex(p, 512, 256, true)) : null }, hi: null });
    show(p, (e.hi || e.lo).s, (e.hi || e.lo).c); atmU.col.value.setRGB(...ATM[k]);
    if (!e.hi && !e.busy) upgrade(p, e);
  };
  const go = async (i, openDrawer) => {
    if (!live || busy) return;
    if (i === cur) { if (openDrawer) toggleDrawer(); return; }
    busy = true; const p = planets[i], first = cur < 0; cur = i;
    app.classList.add('swap'); markActive();
    const s0 = root.scale.x;
    if (!first) await tween(380, (k) => { const e = ease(k); root.scale.setScalar(s0 * (1 - .22 * e)); mat.opacity = cloudMat.opacity = 1 - e; atmU.op.value = 1 - e; });
    setPlanetTex(p);
    fillText(p); if ($('rail').classList.contains('detail') || openDrawer) toggleDrawer(true);
    root.visible = true; const sc = scaleOf(p); vel = .02;
    await tween(900, (k) => { const e = ease(k); root.scale.setScalar(sc * (.78 + .22 * e)); mat.opacity = cloudMat.opacity = e; atmU.op.value = e; });
    app.classList.remove('swap'); busy = false;
  };

  /* правая панель */
  const thumb = (p, S = 80) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.scale(S / 80, S / 80);
    g.save(); g.beginPath(); g.arc(40, 40, 40, 0, 7); g.clip();
    g.drawImage(makeTex(p, S > 80 ? 256 : 128, S > 80 ? 128 : 64), 0, 0, 160, 80); const sh = g.createRadialGradient(26, 30, 6, 40, 40, 44); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.75)'); g.fillStyle = sh; g.fillRect(0, 0, 80, 80); g.restore(); return c;
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
