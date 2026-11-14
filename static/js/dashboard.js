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
  // fbm с целым периодом по X — убирает швы на сфере
  const fbm = (n, u, v, sx, sy, o) => {
    let a = .5, f = 1, t = 0;
    const px0 = Math.max(1, Math.round(sx)); // базовый период — целое
    for (let i = 0; i < o; i++) {
      const px = px0 * f;
      t += a * n(u * px, v * sy * f, px);
      a /= 2; f *= 2;
    }
    return t / .97;
  };
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
      if (k === 'gas') {
        // газовый гигант — полосы + турбулентность + штормы (seamless)
        const bands = 11;
        const warp = fbm(n, u, v, 3, 3, 4 + hi) * 1.8;
        const t = Math.sin((v * bands + warp) * Math.PI) * .5 + .5;
        let col = mix(mix(pal[0], pal[1], t), pal[2], (fbm(n, u, v, 5, 18, 3 + hi) - .42) * 1.7);
        const storm = Math.pow(Math.max(0, fbm(n, u, v, 4, 4, 3) - 0.62), 2.2);
        col = mix(col, mix(pal[1], [255, 230, 200], 0.4), storm * 1.8);
        const fine = (fbm(n, u, v, 14, 14, 2 + hi) - .5) * 22;
        return [col[0] + fine, col[1] + fine * 0.9, col[2] + fine * 0.7].map(q => Math.max(0, Math.min(255, q)));
      }
      if (k === 'ice') {
        const bands = 4, w = fbm(n, u, v, 3, 3, 3 + hi) * .55;
        const t = Math.sin((v * bands + w) * Math.PI) * .5 + .5;
        return mix(mix(pal[0], pal[1], t), pal[2], (fbm(n, u, v, 6, 20, 3 + hi) - .45) * 1.5);
      }
      if (k === 'ocean') {
        // сильный перепад высот: глубокий океан + высокие горы (seamless)
        const base = fbm(n, u, v, 3, 3, 5 + hi);
        const ridge = fbm(n, u, v, 6, 6, 4 + hi);
        const h = base * 0.65 + ridge * 0.35;
        const h2 = fbm(n, u, v, 7, 7, 3 + hi);
        const pole = Math.abs(v - .5) * 2;
        let col;
        if (h < .46) {
          const depth = h / .46;
          col = mix([2, 12, 40], [20, 80, 150], Math.pow(depth, 1.4));
          if (h > .38) col = mix(col, [40, 130, 185], (h - .38) * 8);
        } else {
          const t = (h - .46) / .54;
          const moisture = h2;
          let ground = mix([50, 115, 50], [35, 90, 40], moisture);
          ground = mix(ground, [145, 130, 80], Math.max(0, t - 0.2) * 1.8);
          ground = mix(ground, [120, 105, 90], Math.max(0, t - 0.45) * 2.2);
          ground = mix(ground, [160, 155, 150], Math.max(0, t - 0.68) * 2.5);
          if (t > .78) ground = mix(ground, [240, 245, 250], (t - .78) * 4.5);
          col = ground;
        }
        if (pole > .85 + n(u * 32, 2, 32) * .06) col = mix(col, [245, 248, 252], Math.min(1, (pole - .85) * 7));
        return col;
      }
      if (k === 'lava') {
        const h = fbm(n, u, v, 4, 4, 5 + hi), cr = Math.abs(h - .5);
        let col = mix([28, 18, 16], [70, 45, 38], fbm(n, u, v, 8, 8, 3 + hi));
        if (cr < .045) col = mix(col, [255, 110, 25], 1 - cr / .045);
        return col;
      }
      // barren
      const h = fbm(n, u, v, 5, 5, 6 + hi);
      const s2 = .7 + .55 * fbm(n, u, v, 14, 14, 3 + hi);
      let col = mix([75, 68, 62], [175, 155, 135], h);
      if (h > .7) col = mix(col, [210, 200, 190], (h - .7) * 2);
      return col.map(q => q * s2);
    };
    const clouds = (u, v) => {
      // seamless: только целые периоды, без дробных множителей u
      const large = fbm(n, u, v, 4, 4, 4 + hi);
      const mid   = fbm(n, u, v, 8, 9, 3 + hi);
      const fine  = fbm(n, u, v, 16, 18, 2);
      let dens, col;
      if (k === 'gas') {
        dens = 0.42;
        const band = Math.sin(v * 14 + large * 2.5) * .5 + .5;
        const a = Math.max(0, Math.min(1, (large * .5 + mid * .35 + band * .25 - dens) * 3.8));
        col = mix([255, 245, 220], [255, 220, 170], mid);
        return [col[0], col[1], col[2], a * 160];
      }
      if (k === 'lava') {
        dens = 0.56;
        col = [55, 40, 35];
      } else if (k === 'ice') {
        dens = 0.48;
        col = [230, 240, 255];
      } else {
        dens = 0.47;
        col = [255, 255, 255];
      }
      const a = Math.max(0, Math.min(1, (large * .55 + mid * .35 + fine * .15 - dens) * 4.2));
      const soft = Math.pow(a, 1.35);
      return [col[0], col[1], col[2], soft * (k === 'lava' ? 190 : 245)];
    };
    return { canvas: c, until(ms) { const t0 = performance.now(); let done = y >= H; while (!done && performance.now() - t0 < ms) done = this.step(4); return done; }, step(rows) {
      const e = Math.min(H, y + rows);
      for (; y < e; y++) for (let x = 0; x < W; x++) {
        const col = cloud ? clouds(x / W, y / H) : surf(x / W, y / H);
        const i = (y * W + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col.length > 3 ? col[3] : 255;
      }
      if (y >= H) {
        // принудительно сшиваем левый и правый край (убирает шов)
        for (let yy = 0; yy < H; yy++) {
          const L = (yy * W) * 4, R = (yy * W + W - 1) * 4;
          for (let c = 0; c < 4; c++) {
            const avg = (d[L + c] + d[R + c]) * 0.5;
            d[L + c] = d[R + c] = avg;
          }
        }
        g.putImageData(im, 0, 0);
        return true;
      }
      return false;
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

  // планета: поверхность + облака + объёмная атмосфера (повышенное качество)
  const tilt = new T.Group(), root = new T.Group(); root.add(tilt); scene.add(root);
  const mat = new T.MeshStandardMaterial({ roughness: .88, metalness: 0.04, transparent: true });
  const mesh = new T.Mesh(new T.SphereGeometry(1, 128, 96), mat);
  const cloudMat = new T.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  const cloud = new T.Mesh(new T.SphereGeometry(1.02, 128, 96), cloudMat); cloud.renderOrder = 1;
  const atmU = { col: { value: new T.Color(1, 1, 1) }, op: { value: 0 }, sun: { value: new T.Vector3(-1, 0, 0) } };
  const aHead = 'uniform vec3 col;uniform float op;uniform vec3 sun;varying vec3 n;varying vec3 vView;';
  const aSun = 'float ndl=max(dot(normalize(n),normalize(sun)),0.);float sd=dot(vec3(0.,0.,1.),sun);float s=(.15+.85*smoothstep(-.4,.9,ndl))*(.5+.6*smoothstep(-.25,.95,sd));';
  const mkAtm = (rad, side, fs, order) => {
    const m = new T.Mesh(new T.SphereGeometry(rad, 80, 60), new T.ShaderMaterial({
      uniforms: atmU, transparent: true, side, blending: T.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 n;varying vec3 vView;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader: aHead + fs
    }));
    m.renderOrder = order;
    return m;
  };
  // внутренний слой — rim, ярче со стороны солнца, слегка виден с тёмной
  const atmIn = mkAtm(1.016, T.FrontSide,
    'void main(){float fres=pow(1.-max(dot(normalize(n),vView),0.),3.0);' + aSun +
    'float a=fres*(0.55+0.55*s)*op;gl_FragColor=vec4(col*a*1.25,a*0.8);}', 2);
  // внешний слой — компактный, с видимой кромкой на терминаторе и ночной стороне
  const atmOut = mkAtm(1.085, T.BackSide,
    'void main(){float fres=pow(max(0.58-dot(normalize(n),vView),0.),2.6);' + aSun +
    'float a=fres*(0.65+0.5*s)*op;gl_FragColor=vec4(col*a*1.7,a*0.8);}', 3);
  tilt.add(mesh, cloud, atmIn, atmOut); tilt.rotation.z = .3; root.visible = false;

  // солнце-вступление — мягкое плавное cinematic glow (без колец)
  const makeSunTex = () => {
    const W = 1024, H = 512, n = mkNoise(rng(42)), c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const swirl = fbm(n, u, v, 5.5, 5.5, 5);
        const swirl2 = fbm(n, u + 1.9, v + 0.6, 3.8, 3.8, 4);
        let col = mix([255, 215, 130], [255, 250, 225], swirl * 0.7 + 0.3);
        col = mix(col, [255, 235, 170], swirl2 * 0.4);
        const hot = Math.max(0, swirl - 0.52) * 2.0;
        col = mix(col, [255, 255, 248], hot * 0.55);
        const i = (y * W + x) * 4;
        d[i] = Math.min(255, col[0]); d[i + 1] = Math.min(255, col[1]); d[i + 2] = Math.min(255, col[2]); d[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return new T.CanvasTexture(c);
  };

  // Очень мягкий радиальный градиент (много стопов = плавный переход)
  const makeSoftGlow = (stops) => {
    const s = 512, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    stops.forEach(([t, col]) => r.addColorStop(t, col));
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
    const tex = new T.CanvasTexture(c);
    tex.magFilter = T.LinearFilter;
    tex.minFilter = T.LinearFilter;
    return tex;
  };

  const sunG = new T.Group();

  // Ядро
  const sunMat = new T.ShaderMaterial({
    uniforms: { map: { value: makeSunTex() } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vec4 tex = texture2D(map, vUv);
        float mu = max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
        float limb = 0.82 + 0.18 * pow(mu, 0.55);
        vec3 col = tex.rgb * limb;
        col += vec3(0.35, 0.22, 0.07) * pow(mu, 2.0);
        col = min(col * 1.2, vec3(1.45));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sunMesh = new T.Mesh(new T.SphereGeometry(1.32, 96, 64), sunMat);

  // --- Только мягкие спрайты с очень плавными градиентами (никаких жёстких сфер) ---

  // 1. Плотное ядро (закрывает край 3D-сферы)
  const gCore = new T.Sprite(new T.SpriteMaterial({
    map: makeSoftGlow([
      [0.00, 'rgba(255,255,245,1.00)'],
      [0.12, 'rgba(255,250,220,0.95)'],
      [0.28, 'rgba(255,235,170,0.70)'],
      [0.48, 'rgba(255,200,100,0.25)'],
      [0.70, 'rgba(255,160,50,0.06)'],
      [1.00, 'rgba(255,130,30,0.00)'],
    ]),
    blending: T.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  gCore.scale.setScalar(3.6);

  // 2. Основной мягкий ореол
  const gMain = new T.Sprite(new T.SpriteMaterial({
    map: makeSoftGlow([
      [0.00, 'rgba(255,245,200,0.85)'],
      [0.18, 'rgba(255,225,140,0.55)'],
      [0.40, 'rgba(255,190,80,0.22)'],
      [0.65, 'rgba(255,150,45,0.06)'],
      [1.00, 'rgba(255,110,25,0.00)'],
    ]),
    blending: T.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  gMain.scale.setScalar(7.5);

  // 3. Широкая корона
  const gCorona = new T.Sprite(new T.SpriteMaterial({
    map: makeSoftGlow([
      [0.00, 'rgba(255,230,150,0.45)'],
      [0.22, 'rgba(255,195,90,0.22)'],
      [0.50, 'rgba(255,155,50,0.07)'],
      [0.78, 'rgba(255,120,30,0.015)'],
      [1.00, 'rgba(255,90,20,0.00)'],
    ]),
    blending: T.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  gCorona.scale.setScalar(13);

  // 4. Дальний cinematic bloom
  const gBloom = new T.Sprite(new T.SpriteMaterial({
    map: makeSoftGlow([
      [0.00, 'rgba(255,210,110,0.22)'],
      [0.30, 'rgba(255,165,55,0.08)'],
      [0.60, 'rgba(255,125,35,0.02)'],
      [1.00, 'rgba(255,90,20,0.00)'],
    ]),
    blending: T.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  gBloom.scale.setScalar(22);

  sunG.add(sunMesh, gCore, gMain, gCorona, gBloom);
  sunG.position.y = -4.5;
  scene.add(sunG);

  /* ---------- раскладка / рендер ---------- */
  const layout = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', layout); layout();

  let vel = .0016, zoomT = 6.2, dist = 6.2, fk = 1, baseSc = 1, snap = false, wasOn = false, tPrev = performance.now(), cardOpen = true, dotsN = 9, dotsL = -1, yaw = 0, pitch = 0, yv = 0, pv = 0, uiLast = -1, hov = false, drag = null, pd = 0;
  const drift = { x: 0, y: 0 }, dv = { x: 0, y: 0 }, sh = { x: 0, y: 0 }, ptrs = new Map(), railEl = $('rail'), cardEl = $('card'), dotsEl = $('dots');
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
    const now = performance.now(), dt = Math.min(.05, (now - tPrev) / 1000); tPrev = now; starU.t.value = now / 1000;
    const k1 = 1 - Math.exp(-dt * 8), k2 = 1 - Math.exp(-dt * 7), k3 = 1 - Math.exp(-dt * 5); // сглаживание по времени, а не по кадрам
    mesh.rotation.y += vel; cloud.rotation.y += vel * .35; vel += (.0016 - vel) * .03; sunMesh.rotation.y += .0007; // собственное вращение планеты
    if (!ptrs.size) { yaw += yv; pitch = Math.max(-1.25, Math.min(1.25, pitch + pv)); yv *= .92; pv *= .92; drift.x += dv.x; drift.y += dv.y; dv.x *= .93; dv.y *= .93; }
    dist += (zoomT * fk - dist) * k1;
    // камера летает вокруг планеты, солнце остаётся на месте → видно дневную и ночную стороны
    cam.position.set(dist * Math.sin(yaw) * Math.cos(pitch), dist * Math.sin(pitch), dist * Math.cos(yaw) * Math.cos(pitch)); cam.lookAt(0, 0, 0);
    stars.rotation.y = yaw + drift.y; stars.rotation.x = -pitch + drift.x; // звёзды стоят, а при вращении слегка идут вслед
    // свободная область для планеты: шапка, правая панель, карточка-подсказка и карусель
    const w = stage.clientWidth, h = stage.clientHeight, mob = w <= 650, mode = w > 1100 ? 'right' : w > 900 ? 'left' : 'bottom';
    const kz = c01((dist / fk - 2.4) / 3.8), on = app.classList.contains('live');
    const rw = !railEl.classList.contains('min') && w > 650 ? railEl.offsetWidth : 0;
    const A = { l: 0, r: w - rw, t: mob ? 64 : 80, b: h - (mob ? 56 : 74) }, B = { ...A };
    if (cardOpen) { // место под карточку резервируется сразу, даже пока она ещё прозрачна
      const cr = cardEl.getBoundingClientRect();
      if (mode === 'right') B.r = Math.min(B.r, cr.left - 20); else if (mode === 'left') B.l = Math.max(B.l, cr.right + 20);
      else B.b = mob ? Math.max(A.t + 140, cr.top + cr.height * .45) : Math.max(A.t + 140, cr.top - 10);
    }
    const cx = (A.l + A.r) / 2 + ((B.l + B.r) / 2 - (A.l + A.r) / 2) * kz, cy = (A.t + A.b) / 2 + ((B.t + B.b) / 2 - (A.t + A.b) / 2) * kz;
    const fitK = Math.max(1, (h / 2) * baseSc / (Math.tan(.349) * .36 * Math.max(120, Math.min(B.r - B.l, B.b - B.t))) / 6.2); // на маленьких экранах планета отъезжает, чтобы влезть
    fk += (fitK - fk) * k3;
    const tx = on ? w / 2 - cx : 0, ty = on ? h / 2 - cy : 0;
    if (on && (!wasOn || snap)) { wasOn = true; snap = false; fk = fitK; dist = zoomT * fk; sh.x = tx; sh.y = ty; } // без «въезда» на место
    sh.x += (tx - sh.x) * k2; sh.y += (ty - sh.y) * k2; cam.setViewOffset(w, h, sh.x, sh.y, w, h);
    const dl = (A.l + A.r) / 2; if (Math.abs(dl - dotsL) > .5) { dotsEl.style.left = dl + 'px'; dotsL = dl; } // карусель по центру свободной области
    const nn = mob ? 3 : Math.max(3, Math.min(9, Math.floor((A.r - A.l) / 104))), n2 = nn % 2 ? nn : nn - 1;
    if (on && cur >= 0 && n2 !== dotsN) { dotsN = n2; markActive(); }
    cam.updateMatrixWorld(); sunV.copy(sunDir).transformDirection(cam.matrixWorldInverse); atmU.sun.value.copy(sunV);
    const ui = .12 + .88 * c01((dist / fk - 3.2) / 2.4); // ближе к планете — интерфейс прозрачнее
    if (Math.abs(ui - uiLast) > .01) { app.style.setProperty('--ui', ui.toFixed(2)); uiLast = ui; }
    const sc = root.scale.x, rr = sc * dist / Math.sqrt(Math.max(dist * dist - sc * sc, .01));
    ring.position.copy(root.position); ring.scale.setScalar(2 * rr * 1.045 * 256 / 240); ring.material.opacity += ((hov ? 1 : 0) - ring.material.opacity) * .2;
    renderer.render(scene, cam);
  };
  loop();

  // вращение (мышь/палец), приближение (колесо/щипок), наведение и клик
  stage.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = drag || { m: 0, x0: e.clientX, y0: e.clientY, swipe: e.pointerType === 'touch' && !pick(e) }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    const q = ptrs.get(e.pointerId);
    if (!q) { const hh = pick(e); if (hh !== hov) { hov = hh; stage.style.cursor = hh ? 'pointer' : ''; } return; }
    const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY; drag.m += Math.abs(dx) + Math.abs(dy);
    if (drag.swipe && ptrs.size === 1) return;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y); if (pd) zoomT = clampZ(zoomT * pd / dd); pd = dd; drag.m += 99; return; }
    yaw -= dx * .006; pitch = Math.max(-1.25, Math.min(1.25, pitch + dy * .005)); yv = -dx * .0012; pv = dy * .001;
    drift.y -= dx * .0012; drift.x -= dy * .0012; dv.y = -dx * .0004; dv.x = -dy * .0004;
  });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomT = clampZ(zoomT * Math.exp(e.deltaY * .0012)); }, { passive: false });
  const end = (e) => {
    ptrs.delete(e.pointerId); pd = 0;
    if (!ptrs.size) {
      const moved = drag && drag.m > 5, d0 = drag; drag = null;
      if (d0 && d0.swipe && e.type === 'pointerup') { // свайп влево/вправо → следующая/предыдущая планета
        const dx = e.clientX - d0.x0, dy = e.clientY - d0.y0, n = cur + (dx < 0 ? 1 : -1);
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2 && n >= 0 && n < planets.length) go(n, false, dx < 0 ? 1 : -1);
      } else if (!moved && e.type === 'pointerup' && pick(e)) toggleDrawer();
    }
  };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);

  /* ---------- UI ---------- */
  const tween = (ms, f) => new Promise((res) => { const t0 = performance.now(); const s = (t) => { const k = Math.max(0, Math.min(1, (t - t0) / ms)); f(k); k < 1 ? requestAnimationFrame(s) : res(); }; requestAnimationFrame(s); });
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
    $('dName').textContent = p.name; $('dDesc').textContent = descOf(p).join(String.fromCharCode(10, 10)); const dc = $('dThumb').getContext('2d'); dc.clearRect(0, 0, 192, 192); dc.drawImage(thumb(p, 192), 0, 0);
    const r = [['Тип', KIND[kindOf(p)]], ['Звезда', p.st_spectype], ['Масса', `${fx(p.pl_bmasse)} M⊕`], ['Плотность (отн.)', fx(p.pl_dens)], ['Скорость убегания', `${fx(p.v_esc * 11.186, 1)} км/с`], ['Каменистая', p.is_rocky ? 'да' : 'нет'], ['Качество данных', p.data_grade], ...rows(p)];
    $('dData').innerHTML = r.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  };
  const setRail = (min) => { railEl.classList.toggle('min', min); app.classList.toggle('railmin', min); };
  const toggleDrawer = (open) => { // данные открываются прямо в правой панели вместо списка
    const r = $('rail'), on = open ?? !r.classList.contains('detail'); if (on && cur < 0) return;
    r.classList.toggle('detail', on); if (on) { setRail(false); fillDrawer(planets[cur]); }
  };

  const cache = {}, hiList = [], frame = () => new Promise(requestAnimationFrame), maxA = renderer.capabilities.getMaxAnisotropy();
  const mk = (cv) => {
    const t = new T.CanvasTexture(cv);
    t.anisotropy = maxA;
    t.wrapS = T.RepeatWrapping; // важно для бесшовного стыка по долготе
    t.wrapT = T.ClampToEdgeWrapping;
    return t;
  };
  const BUMP = { barren: .12, lava: .09, ocean: .08, gas: 0.012, ice: 0.01 }, CLOUDY = { ocean: 1, lava: 1, ice: 1, gas: 1 };
  const show = (p, sf, cl) => { const k = kindOf(p), fresh = !mat.map || !!cloudMat.map !== !!cl; mat.map = sf; mat.bumpMap = sf; mat.bumpScale = BUMP[k]; cloud.visible = !!CLOUDY[k]; cloudMat.map = cl; if (fresh) { mat.needsUpdate = true; cloudMat.needsUpdate = true; } };
  const slice = async (j, ms, stop) => { while (!j.until(ms)) { await frame(); if (stop && stop()) return false; } return true; }; // кусок = ms миллисекунд на кадр
  const pre = {};
  const prepare = (p) => pre[p.id] || (pre[p.id] = (async () => { // быстрая версия текстуры; считается, пока старая планета уходит (или пока играет солнце)
    const k = kindOf(p), js = texJob(p, 512, 256), jc = CLOUDY[k] ? texJob(p, 512, 256, true) : null;
    await slice(js, 10); if (jc) await slice(jc, 10);
    return (cache[p.id] = { lo: { s: mk(js.canvas), c: jc ? mk(jc.canvas) : null }, hi: null });
  })());
  const upgrade = async (p, e) => { // чёткая 2048×1024 догружается только после анимации, по 6 мс на кадр
    e.busy = true; const k = kindOf(p), js = texJob(p, 2048, 1024), jc = CLOUDY[k] ? texJob(p, 1024, 512, true) : null, gone = () => planets[cur] !== p;
    if (!(await slice(js, 6, gone)) || (jc && !(await slice(jc, 6, gone)))) { e.busy = false; return; }
    e.hi = { s: mk(js.canvas), c: jc ? mk(jc.canvas) : null }; e.busy = false; hiList.push(e);
    while (hiList.length > 3) { const o = hiList.shift(); if (o.hi) { o.hi.s.dispose(); o.hi.c && o.hi.c.dispose(); o.hi = null; } }
    if (planets[cur] === p) show(p, e.hi.s, e.hi.c);
  };
  const setPlanetTex = (p, e) => { show(p, (e.hi || e.lo).s, (e.hi || e.lo).c); atmU.col.value.setRGB(...ATM[kindOf(p)]); };
  const go = async (i, openDrawer, dir = 0) => { // dir = ±1: перелёт влево/вправо (карусель, свайп, стрелки); 0: анимация из списка
    if (!live || busy) return;
    if (i === cur) { if (openDrawer) toggleDrawer(); return; }
    busy = true; const p = planets[i], first = cur < 0; cur = i; hov = false;
    cardOpen = true; baseSc = scaleOf(p); // раскладка сразу учитывает карточку и размер новой планеты — ничего не «съезжает» после анимации
    if (!first) cardEl.classList.remove('off');
    app.classList.add('is-swapping'); markActive();
    const prep = prepare(p); // текстура считается кусками, пока старая планета уходит
    const s0 = root.scale.x, rv = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), D = dist * .55;
    if (!first) await tween(dir ? 420 : 380, (k) => { const e = ease(k); if (dir) root.position.copy(rv).multiplyScalar(-dir * D * e); else root.scale.setScalar(s0 * (1 - .22 * e)); mat.opacity = cloudMat.opacity = 1 - e; atmU.op.value = 1 - e; });
    const e = await prep; setPlanetTex(p, e);
    fillText(p); if ($('rail').classList.contains('detail') || openDrawer) toggleDrawer(true);
    const sc = baseSc; vel = .02; snap = true; // планета сейчас невидима — мгновенно ставим камеру/сдвиг в итоговое положение
    mat.opacity = cloudMat.opacity = 0; atmU.op.value = 0;
    if (dir) { root.scale.setScalar(sc); root.position.copy(rv).multiplyScalar(dir * D); } else root.scale.setScalar(sc * .78);
    root.visible = true;
    await tween(dir ? 800 : 900, (k) => { const e2 = ease(k); if (dir) root.position.copy(rv).multiplyScalar(dir * D * (1 - e2)); else root.scale.setScalar(sc * (.78 + .22 * e2)); mat.opacity = cloudMat.opacity = e2; atmU.op.value = e2; });
    root.position.set(0, 0, 0); app.classList.remove('is-swapping'); busy = false;
    if (first) cardEl.classList.remove('off'); // карточка плавно появляется после первой планеты
    if (!e.hi && !e.busy) upgrade(p, e);
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
  $('railMin').onclick = () => setRail(true);
  $('railOpen').onclick = () => setRail(false);
  setRail(true); // изначально боковая панель свёрнута
  $('dClose').onclick = () => toggleDrawer(false);

  /* карусель-точки */
  const dots = $('dots');
  const markActive = () => {
    const n = dotsN, s = Math.max(0, Math.min(planets.length - n, cur - (n >> 1)));
    dots.innerHTML = '';
    planets.slice(s, s + n).forEach((p, k) => {
      const b = document.createElement('button'); b.className = s + k === cur ? 'on' : ''; b.innerHTML = `<i></i><span>${p.name}</span>`; b.setAttribute('aria-label', p.name);
      b.onclick = () => go(s + k, false, Math.sign(s + k - cur)); dots.appendChild(b);
    });
    [...list.children].forEach((li) => li.classList.toggle('on', +li.dataset.i === cur));
  };
  addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' && cur < planets.length - 1) go(cur + 1, false, 1); if (e.key === 'ArrowLeft' && cur > 0) go(cur - 1, false, -1); });
  $('cClose').onclick = () => { cardOpen = false; cardEl.classList.add('off'); }; // описание остаётся в правой панели над данными
  let sx0 = null; // свайп по карусели
  dots.addEventListener('pointerdown', (e) => { sx0 = e.clientX; });
  addEventListener('pointerup', (e) => { if (sx0 === null) return; const dx = e.clientX - sx0, n = cur + (dx < 0 ? 1 : -1); sx0 = null; if (Math.abs(dx) > 40 && n >= 0 && n < planets.length) go(n, false, dx < 0 ? 1 : -1); });

  /* ---------- вступление: солнце поднимается, затем — вспышка и первая планета ---------- */
  const intro = $('intro'), flash = $('flash'); intro.style.opacity = 0;
  setTimeout(() => (intro.style.opacity = 1), 900);
  prepare(planets[0]); // первая планета готовится, пока играет солнце
  await tween(3600, (k) => {
    const e = ease(k);
    sunG.position.y = -4.5 + 4.5 * e;
    sunG.scale.setScalar(1.9 - 0.9 * e);
    // тёплый мягкий свет
    sunLight.intensity = 1.4 + 2.2 * e;
    sunLight.color.setRGB(1.0, 0.93 + 0.04 * e, 0.76 + 0.1 * e);
  });
  await new Promise((r) => setTimeout(r, 1000));
  flash.style.transition = 'opacity .7s'; flash.style.opacity = 1; await new Promise((r) => setTimeout(r, 750));
  scene.remove(sunG); intro.style.opacity = 0; // вернуться к солнцу нельзя (заглушка)
  // возвращаем нормальный свет для планет
  sunLight.intensity = 2.4;
  sunLight.color.setRGB(1.0, 0.95, 0.86);
  live = true; app.classList.add('live'); flash.style.transition = 'opacity 1.4s'; flash.style.opacity = 0;
  go(0);
});
