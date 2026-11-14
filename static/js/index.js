  // Portal Field: автономная реализация на Three.js, без React, JSX и iframe.
  (() => {
    const canvas = document.getElementById('portal-field');
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer, scene, camera, material, geometry, mesh, raf = 0, resizeObserver;
    let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0, startedAt = 0;

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform vec2 u_mouse;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x),
                   mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y);
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        float aspect = u_resolution.x / max(u_resolution.y, 1.0);
        vec2 p = uv - 0.5;
        p.x *= aspect;

        float t = u_time * 0.22;
        vec2 mouse = (u_mouse - 0.5) * vec2(aspect, 1.0) * 0.10;
        float n1 = noise(p * 5.0 + vec2(t, -t * 0.7));
        float n2 = noise(p * 10.0 - vec2(t * 0.6, t));
        float warp = (n1 - 0.5) * 0.055 + (n2 - 0.5) * 0.018;
        float radius = length(p - mouse * 0.22);
        float angle = atan(p.y, p.x);
        float wobble = sin(angle * 3.0 + t * 1.8) * 0.012 + cos(angle * 5.0 - t) * 0.006;
        float ringRadius = 0.255 + warp + wobble;
        float ringDist = abs(radius - ringRadius);
        float ring = exp(-pow(ringDist / 0.012, 2.0));
        float outerGlow = exp(-pow(ringDist / 0.060, 2.0));
        float innerGlow = exp(-pow((radius - 0.205) / 0.075, 2.0));

        float arcA = smoothstep(-0.35, 0.08, sin(angle * 1.0 + t * 0.55));
        float arcB = smoothstep(-0.25, 0.25, sin(angle * 1.0 - t * 0.38 + 2.1));
        float arcMask = max(arcA, arcB * 0.72);
        float fineArc = exp(-pow((radius - (ringRadius + 0.025)) / 0.004, 2.0)) * arcMask;

        vec3 deep = vec3(0.008, 0.015, 0.040);
        vec3 blue = vec3(0.20, 0.48, 1.00);
        vec3 cyan = vec3(0.40, 0.86, 1.00);
        vec3 violet = vec3(0.48, 0.30, 1.00);
        float pulse = 0.78 + 0.22 * sin(t * 2.0 + angle * 2.0);

        vec3 color = deep;
        color += blue * outerGlow * 0.34;
        color += mix(blue, violet, 0.5 + 0.5 * sin(angle * 2.0 - t)) * ring * pulse * 1.55;
        color += cyan * fineArc * 0.75;
        color += violet * innerGlow * 0.13;

        float core = 1.0 - smoothstep(0.115, 0.145, radius);
        float coreEdge = exp(-pow((radius - 0.14) / 0.012, 2.0));
        color = mix(color, vec3(0.004, 0.008, 0.020), core * 0.92);
        color += vec3(0.55, 0.78, 1.0) * coreEdge * 0.75;

        float vignette = 1.0 - smoothstep(0.34, 0.72, length(p / vec2(max(aspect, 1.0), 1.0)));
        color *= vignette;
        float alpha = clamp(max(max(ring * 0.95, outerGlow * 0.72), max(innerGlow * 0.28, coreEdge)), 0.0, 1.0);
        alpha *= vignette;
        gl_FragColor = vec4(color, max(alpha, 0.08));
      }
    `;

    function init() {
      if (!window.THREE) {
        canvas.classList.add('portal-fallback');
        console.error('Three.js не загрузился. Проверь подключение к CDN.');
        return;
      }
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        geometry = new THREE.PlaneBufferGeometry(2, 2);
        material = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms: {
            u_resolution: { value: new THREE.Vector2(1, 1) },
            u_time: { value: 0 },
            u_mouse: { value: new THREE.Vector2(0.5, 0.5) }
          },
          transparent: true,
          depthWrite: false
        });
        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        resize();
        if ('ResizeObserver' in window) {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(host);
        } else {
          window.addEventListener('resize', resize, { passive: true });
        }
        host.addEventListener('pointermove', onPointerMove, { passive: true });
        host.addEventListener('pointerleave', onPointerLeave, { passive: true });
        startedAt = performance.now();
        render(startedAt);
      } catch (error) {
        console.error('Не удалось запустить Portal Field:', error);
      }
    }

    function resize() {
      if (!renderer || !material) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      material.uniforms.u_resolution.value.set(
        Math.floor(width * renderer.getPixelRatio()),
        Math.floor(height * renderer.getPixelRatio())
      );
    }

    function onPointerMove(event) {
      const rect = host.getBoundingClientRect();
      targetX = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
      targetY = THREE.MathUtils.clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    }
    function onPointerLeave() { targetX = 0.5; targetY = 0.5; }

    function render(now) {
      raf = requestAnimationFrame(render);
      const elapsed = reducedMotion ? 0 : (now - startedAt) / 1000;
      pointerX += (targetX - pointerX) * 0.045;
      pointerY += (targetY - pointerY) * 0.045;
      material.uniforms.u_time.value = elapsed;
      material.uniforms.u_mouse.value.set(pointerX || 0.5, pointerY || 0.5);
      renderer.render(scene, camera);
    }

    function destroy() {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
    window.addEventListener('pagehide', destroy, { once: true });
  })();

  // Галактика из частиц: растянута на весь блок секции «Топ-50 планет».
  (() => {
    const canvas = document.getElementById('galaxyfield'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, particles = [], raf = 0, visible = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(4200, Math.max(900, Math.floor(w * h / 380)));
      particles = Array.from({ length: count }, () => ({
        a: Math.random() * Math.PI * 2,
        rn: Math.pow(Math.random(), .78),          // 0..1 — доля радиуса эллипса, а не пиксели
        sz: Math.random() * 1.35 + .25,
        alpha: Math.random() * .75 + .18,
        arm: Math.random() < .5 ? -1 : 1,
        phase: Math.random() * 6.28
      }));
    };

    const draw = t => {
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const rx = w * .6, ry = h * .62;              // эллипс шире самого блока → заполняет его целиком

      // мягкое свечение ядра, тоже растянутое по блоку
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(rx, ry);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, 'rgba(224,235,255,.9)');
      glow.addColorStop(.035, 'rgba(170,195,255,.42)');
      glow.addColorStop(.14, 'rgba(100,135,230,.16)');
      glow.addColorStop(.5, 'rgba(60,95,180,.07)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();

      for (const p of particles) {
        const twist = p.a + p.arm * p.rn * .9 + (t * .000018 * p.arm);
        const x = cx + Math.cos(twist) * p.rn * rx;
        const y = cy + Math.sin(twist) * p.rn * ry;
        const twinkle = reduce ? 1 : .55 + .45 * Math.sin(t * .001 + p.phase);
        const edge = 1 - p.rn * p.rn * .55;
        ctx.beginPath();
        ctx.arc(x, y, p.sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220,232,255,${p.alpha * twinkle * edge})`;
        ctx.fill();
      }
    };

    const loop = t => {
      draw(t);
      raf = (!reduce && visible) ? requestAnimationFrame(loop) : 0;
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(loop); };

    resize(); draw(0); if (!reduce) start();
    if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); draw(0); }).observe(canvas);
    else window.addEventListener('resize', () => { resize(); draw(0); }, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible && !reduce) start(); }).observe(canvas);
    }
  })();

  // Фон-туманность на весь сайт: пиксельное небо, напечатанное точками (WebGL2).
  // Мышь — «лампа», раздвигающая газ; клик роняет новую звезду и пускает волну.
  (() => {
    const canvas = document.getElementById('nebula-bg'); if (!canvas) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) {
      canvas.style.background = 'radial-gradient(60% 45% at 14% 86%,#2a2380 0%,#14123f 42%,transparent 78%),radial-gradient(45% 32% at 86% 18%,#1c3a70 0%,transparent 72%),#05070d';
      return;
    }
    const MAX_SPARKS = 12, MAX_RIPPLES = 4;
    // Настройки под палитру сайта (фиолетовый → голубой).
    const P = { pixel: 6, dotMin: .12, dotMax: .52, levels: 7, scale: 1.7, warp: 1.5, drift: .03, density: .46, threshold: .56, softness: .5,
      band: .45, bandAngle: 1.05, bandOffset: .3, bandWidth: .34, haze: .8, stars: 1, twinkle: 1.4, starDrift: 1, spikeWidth: 1,
      parallax: 1, lens: .5, lensRadius: 170, lensPush: .3, rippleSpeed: 420, vignette: .45, grain: .03, dim: .8 };
    const C = { voidColor: '#04060c', hazeColor: '#0d1233', duskColor: '#1d1a55', wineColor: '#2a2384', crimsonColor: '#6a58f0', hotColor: '#8fd8ff', starColor: '#eef1ff' };
    const SEED = 11, SPARKLES = 9;
    const cap = k => 'u' + k[0].toUpperCase() + k.slice(1);
    const hex = h => { const v = parseInt(h.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
    const decl = Object.keys(P).map(k => 'uniform float ' + cap(k) + ';').concat(Object.keys(C).map(k => 'uniform vec3 ' + cap(k) + ';')).join('\n');

    const VERT = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
    const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform float uScroll;
uniform vec2 uPointer; uniform float uPointerOn; uniform vec2 uLook;
uniform int uSparkCount; uniform vec4 uSpark[${MAX_SPARKS}]; uniform vec4 uSparkB[${MAX_SPARKS}]; uniform vec4 uRipple[${MAX_RIPPLES}];
${decl}
out vec4 frag;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}
float bayer4(vec2 c){
  vec2 m = mod(c, 4.0); int i = int(m.x) + int(m.y) * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}
vec3 ramp(float d, vec3 haze){
  vec3 c = mix(uVoidColor, haze, smoothstep(0.0, 0.22, d));
  c = mix(c, uWineColor, smoothstep(0.18, 0.44, d));
  c = mix(c, uCrimsonColor, smoothstep(0.42, 0.72, d));
  return mix(c, uHotColor, smoothstep(0.7, 0.96, d));
}
vec2 shift(float depth){ return floor(uLook * uParallax * depth * 28.0); }

vec3 field(vec2 pos, vec2 resCss){
  float minSide = min(resCss.x, resCss.y);
  vec2 uv = (pos - 0.5 * resCss) / minSide;
  vec2 p = uv * uScale + uLook * uParallax * 0.05 + vec2(0.0, -uScroll / minSide * 0.22 * uScale);
  vec2 toP = pos - uPointer;
  float lamp = exp(-dot(toP, toP) / (uLensRadius * uLensRadius)) * uPointerOn;
  p += toP / minSide * lamp * uLensPush * uScale;
  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipple[i]; float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 2.4) continue;
    vec2 dv = pos - r.xy; float dist = length(dv); float w = 14.0 + age * 26.0;
    float k = exp(-pow((dist - age * uRippleSpeed) / w, 2.0)) * (1.0 - age / 2.4) * r.w;
    ring += k; p += dv / max(dist, 1.0) * k * 0.12;
  }
  float t = uTime * uDrift;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.7)), fbm(p + vec2(5.2, 1.3) - t * 0.5));
  float n = fbm(p + uWarp * q + vec2(t * 0.4, -t * 0.25));
  vec2 dir = vec2(cos(uBandAngle), sin(uBandAngle));
  float along = dot(uv, dir);
  float across = dot(uv, vec2(-dir.y, dir.x)) - uBandOffset - 0.22 * sin(along * 2.3 + t * 3.0) - (q.x - 0.5) * 0.35;
  float river = exp(-across * across / (uBandWidth * uBandWidth));
  float raw = n + river * uBand * 0.5 + (uDensity - 0.5) * 0.5;
  float d = smoothstep(uThreshold, uThreshold + uSoftness, raw);
  d = clamp(d + lamp * uLens * 0.45 + ring * 0.55, 0.0, 1.0);
  for (int i = 0; i < ${MAX_SPARKS}; i++) {
    if (i >= uSparkCount) break;
    vec4 s = uSpark[i]; vec4 b = uSparkB[i];
    float grow = smoothstep(0.0, 0.6, uTime - s.w);
    float dist = length(pos - s.xy - shift(1.2));
    d += exp(-dist / max(b.w * 2.2 * (1.0 + b.z * 0.6), 1.0)) * 0.55 * grow;
  }
  float hz = smoothstep(0.25, 0.75, n + river * 0.25) * uHaze;
  float tone = fbm(p * 0.45 + vec2(11.0, -3.0) + t * 0.2);
  return vec3(clamp(d, 0.0, 1.0), hz, tone);
}

void main(){
  vec2 resCss = uRes / uDpr;
  vec2 css = gl_FragCoord.xy / uDpr;
  float px = max(uPixel, 1.0);
  vec2 cell = floor(css / px);
  vec2 cellC = (cell + 0.5) * px;
  vec2 f = fract(css / px) - 0.5;
  float L = max(uLevels, 2.0);
  float dith = bayer4(cell);

  vec3 g = field(cellC, resCss);
  vec3 hazeCol = mix(uHazeColor, uDuskColor, smoothstep(0.38, 0.62, g.z));
  float dq = clamp(floor(g.x * L + dith) / L, 0.0, 1.0);
  float hq = floor(g.y * 3.0 + dith) / 3.0;
  vec3 bg = mix(uVoidColor, hazeCol, hq * 0.7);
  bg = mix(bg, ramp(dq * 0.7, hazeCol) * 0.42, smoothstep(0.0, 0.3, dq));
  float r = mix(uDotMin, uDotMax, sqrt(dq));
  float dotMask = step(length(f), r);
  vec3 dotCol = dq < 0.01 ? mix(uVoidColor, hazeCol, 0.35 + hq * 0.5) : ramp(min(dq + 0.1, 1.0), hazeCol);
  vec3 col = mix(bg, dotCol, dotMask) * uDim;

  // пиксельные звёзды, три глубины, мерцают и уплывают при прокрутке
  vec3 starAcc = vec3(0.0); float starA = 0.0;
  for (int l = 0; l < 3; l++) {
    float fl = float(l); float depth = 0.3 + fl * 0.4;
    float gpx = px * (l == 2 ? 2.0 : 1.0);
    vec2 sp = css + shift(depth) + vec2(0.0, floor(uTime * uStarDrift * depth) - floor(uScroll * depth * 0.35));
    vec2 id = floor(sp / gpx); vec2 fr = fract(sp / gpx) - 0.5;
    float prob = uStars * (l == 0 ? 0.009 : l == 1 ? 0.014 : 0.01);
    float h = hash12(id + fl * 71.3);
    if (h > 1.0 - prob) {
      float h2 = hash12(id * 1.7 + 3.1 + fl);
      float tw = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * uTwinkle * (0.6 + h2 * 2.5) + h2 * 40.0));
      float rad = l == 2 ? 0.42 : 0.26 + h2 * 0.22;
      float m = step(length(fr), rad);
      vec3 c = (l == 0 || h2 > 0.82) ? uStarColor : uHotColor;
      starAcc = max(starAcc, c * m * tw); starA = max(starA, m * tw);
    }
  }
  col = mix(col, starAcc / max(starA, 1e-3), starA * (1.0 - g.x * 0.55));

  // звёзды-искры: крупное ядро и тонкие лучи
  vec2 sh = shift(1.2);
  for (int i = 0; i < ${MAX_SPARKS}; i++) {
    if (i >= uSparkCount) break;
    vec4 s = uSpark[i]; vec4 b = uSparkB[i];
    float age = uTime - s.w;
    if (age < 0.0) continue;
    float grow = smoothstep(0.0, 0.55, age) * (1.0 + 0.3 * exp(-age * 3.0) * sin(age * 13.0));
    float tw = 0.84 + 0.16 * sin(uTime * uTwinkle * 1.7 + b.y);
    float flare = 1.0 + b.z * 0.6;
    float reach = s.z * grow * tw * flare;
    float core = b.w * grow * flare;
    vec3 tint = mix(uHotColor, uStarColor, b.x);
    vec2 c = s.xy + sh; vec2 d = css - c;
    float th = uSpikeWidth * 0.5 + 0.25;
    float hx = step(abs(d.y), th) * pow(max(1.0 - abs(d.x) / max(reach, 1.0), 0.0), 1.1);
    float vy = step(abs(d.x), th) * pow(max(1.0 - abs(d.y) / max(reach, 1.0), 0.0), 1.1);
    vec2 rd = vec2(d.x + d.y, d.x - d.y) * 0.7071;
    float diag = step(0.5, core / px - 1.5) * 0.45 * max(
      step(abs(rd.y), th) * pow(max(1.0 - abs(rd.x) / max(reach * 0.22, 1.0), 0.0), 2.0),
      step(abs(rd.x), th) * pow(max(1.0 - abs(rd.y) / max(reach * 0.22, 1.0), 0.0), 2.0));
    col = mix(col, tint, clamp(max(max(hx, vy), diag), 0.0, 1.0));
    float hp = px * 0.5;
    vec2 dcell = (floor(css / hp) + 0.5) * hp - (floor(c / hp) + 0.5) * hp;
    float disc = step(length(dcell), core);
    float glow = exp(-length(d) / max(core * 1.4, 1.0)) * (1.0 - disc);
    col += tint * glow * 0.35;
    col = mix(col, tint, disc);
    float cross = max(step(abs(d.y), th) * step(abs(d.x), core * 0.85), step(abs(d.x), th) * step(abs(d.y), core * 0.85));
    col = mix(col, uStarColor, cross * disc * 0.9);
  }

  vec2 vu = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(vu * vec2(uRes.x / uRes.y, 1.0) * 1.1));
  col += (hash12(floor(css) + fract(uTime) * 91.0) - 0.5) * uGrain;
  frag = vec4(max(col, vec3(0.0)), 1.0);
}`;

    const compile = (type, s) => { const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error('nebula:', gl.getShaderInfoLog(sh)); return null; } return sh; };
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.style.background = 'radial-gradient(60% 45% at 14% 86%,#2a2380 0%,#14123f 42%,transparent 78%),#05070d'; return; }
    const program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.error('nebula:', gl.getProgramInfoLog(program)); return; }
    const L = n => gl.getUniformLocation(program, n);
    const floatLocs = Object.keys(P).map(k => [L(cap(k)), k]);
    const colorLocs = Object.keys(C).map(k => [L(cap(k)), hex(C[k])]);
    const U = { res: L('uRes'), dpr: L('uDpr'), time: L('uTime'), scroll: L('uScroll'), pointer: L('uPointer'), pointerOn: L('uPointerOn'), look: L('uLook'),
      sparkCount: L('uSparkCount'), spark: L('uSpark[0]'), sparkB: L('uSparkB[0]'), ripple: L('uRipple[0]') };
    const vao = gl.createVertexArray();

    // небо с искрами
    function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function layout(seed, count) {
      const rand = mulberry32(seed), out = [];
      for (let i = 0; i < Math.min(count, MAX_SPARKS); i++) {
        const hero = i === 0, pale = i === 1; let x = .5, y = .5;
        for (let tries = 0; tries < 40; tries++) {
          x = .08 + .84 * rand(); y = hero ? .58 + .28 * rand() : .08 + .84 * rand();
          if (out.every(s => Math.hypot(s.x - x, s.y - y) > (hero ? .2 : .13))) break;
        }
        out.push({ x, y, reach: hero ? .15 + .04 * rand() : pale ? .08 + .03 * rand() : .025 + .055 * rand(),
          core: hero ? .02 : pale ? .011 : .004 + .006 * rand(), tint: pale ? 1 : 0, phase: rand() * 6.283, born: -10, user: false });
      }
      return out;
    }
    let sparks = layout(SEED, SPARKLES);
    const flare = new Float32Array(MAX_SPARKS), sparkA = new Float32Array(MAX_SPARKS * 4), sparkB = new Float32Array(MAX_SPARKS * 4), ripples = new Float32Array(MAX_RIPPLES * 4);
    let rippleNext = 0;

    let cssW = 1, cssH = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cssW = Math.max(window.innerWidth, 1); cssH = Math.max(window.innerHeight, 1);
      const w = Math.floor(cssW * dpr), h = Math.floor(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (reduce) paint();
    };

    const t0 = performance.now();
    const clock = () => reduce ? 14 : (performance.now() - t0) / 1000;
    let lastClock = 0, targetX = .5, targetY = .5, lampX = .5, lampY = .5, lookX = 0, lookY = 0, lampOn = 0, inside = false, lastTouched = -1e9;
    const toUv = e => [Math.min(Math.max(e.clientX / cssW, 0), 1), Math.min(Math.max(1 - e.clientY / cssH, 0), 1)];
    window.addEventListener('pointermove', e => { [targetX, targetY] = toUv(e); inside = true; lastTouched = performance.now() / 1000; }, { passive: true });
    document.addEventListener('pointerleave', () => { inside = false; });
    window.addEventListener('pointerdown', e => {
      if (e.button > 0 || reduce) return;
      if (e.target.closest && e.target.closest('a,button,input,textarea,select,label,[role=button]')) return;
      const [x, y] = toUv(e); targetX = x; targetY = y; inside = true; lastTouched = performance.now() / 1000;
      const now = clock(), rand = Math.random();
      const star = { x, y, reach: .045 + .08 * rand, core: .006 + .008 * rand, tint: Math.random() < .2 ? 1 : 0, phase: Math.random() * 6.283, born: now, user: true };
      if (sparks.length < MAX_SPARKS) sparks.push(star);
      else { const old = sparks.findIndex(s => s.user); if (old > -1) { sparks.splice(old, 1); sparks.push(star); } }
      ripples.set([x * cssW, y * cssH, now, 1], rippleNext * 4); rippleNext = (rippleNext + 1) % MAX_RIPPLES;
    }, { passive: true });

    function paint() {
      const t = clock(), dt = Math.min(Math.max(t - lastClock, 0), .1); lastClock = t;
      const idle = !inside || performance.now() / 1000 - lastTouched > 6;
      const dp = t * .6;
      const gx = Math.min(Math.max(.5 + .32 * Math.sin(dp * .21) + .1 * Math.sin(dp * .077 + 1.3), .05), .95);
      const gy = Math.min(Math.max(.5 + .26 * Math.cos(dp * .17) + .12 * Math.cos(dp * .053 + 4.2), .05), .95);
      const wantX = idle ? gx : targetX, wantY = idle ? gy : targetY;
      const k = reduce ? 1 : 1 - Math.exp(-dt * (idle ? 1.5 : 7));
      lampX += (wantX - lampX) * k; lampY += (wantY - lampY) * k;
      lookX += ((wantX - .5) * 2 - lookX) * k; lookY += ((wantY - .5) * 2 - lookY) * k;
      const onT = reduce ? 0 : (idle ? .55 : 1);
      lampOn += (onT - lampOn) * (reduce ? 1 : 1 - Math.exp(-dt * 3));
      const minSide = Math.min(cssW, cssH), n = Math.min(sparks.length, MAX_SPARKS);
      for (let i = 0; i < n; i++) {
        const s = sparks[i], reach = s.reach * minSide;
        const d = Math.hypot((s.x - lampX) * cssW, (s.y - lampY) * cssH);
        const want = reduce ? 0 : Math.exp(-(d * d) / Math.max(reach * reach * .6, 400));
        flare[i] += (want - flare[i]) * (reduce ? 1 : 1 - Math.exp(-dt * 6));
        sparkA.set([s.x * cssW, s.y * cssH, reach, s.born], i * 4);
        sparkB.set([s.tint, s.phase, flare[i], Math.max(s.core * minSide, 1.5)], i * 4);
      }
      gl.useProgram(program); gl.bindVertexArray(vao); gl.viewport(0, 0, canvas.width, canvas.height);
      for (const [l, key] of floatLocs) gl.uniform1f(l, P[key]);
      for (const [l, rgb] of colorLocs) gl.uniform3fv(l, rgb);
      gl.uniform2f(U.res, canvas.width, canvas.height); gl.uniform1f(U.dpr, canvas.width / cssW); gl.uniform1f(U.time, t);
      gl.uniform1f(U.scroll, window.scrollY || 0);
      gl.uniform2f(U.pointer, lampX * cssW, lampY * cssH); gl.uniform1f(U.pointerOn, lampOn); gl.uniform2f(U.look, lookX, lookY);
      gl.uniform1i(U.sparkCount, n); gl.uniform4fv(U.spark, sparkA); gl.uniform4fv(U.sparkB, sparkB); gl.uniform4fv(U.ripple, ripples);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const footer = document.querySelector('.earth-footer');
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (footer && footer.getBoundingClientRect().top <= 0) return;   // подвал закрыл экран — туманность не рисуем
      paint();
    };
    window.addEventListener('resize', resize, { passive: true });
    resize(); paint();
    if (!reduce) raf = requestAnimationFrame(frame);
    else window.addEventListener('scroll', paint, { passive: true });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(raf); });
  })();

  // Подвал: атмосфера с облаками, а ниже — «живая» картина (смена света, блики на реке, листва ловит солнце).
  // Всё считается на лету в шейдере из той же картинки, видео не используется.
  (() => {
    const section = document.querySelector('.earth-footer'), canvas = document.getElementById('earth-live');
    if (!section || !canvas) return;
    const fallback = section.querySelector('.earth-fallback');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
    const FS = `precision highp float;
uniform vec2 uSize; uniform float uDpr; uniform float uAtm; uniform float uTime; uniform float uReady;
uniform vec2 uMouse; uniform float uMouseOn; uniform vec2 uImg; uniform sampler2D uTex;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 3.7); a *= 0.5; }
  return s;
}
// слой облаков: x — плотность, y — освещённость
vec2 cloudL(vec2 q, float sc, float sp, float seed, float cov, float t){
  vec2 p = q * sc + vec2(t * sp + seed, seed * 0.7);
  float w = fbm(p * vec2(1.0, 1.8) + vec2(0.0, t * 0.01)) + 0.18 * fbm(p * 2.7 + 3.0);
  float d = smoothstep(1.0 - cov, 1.0 - cov + 0.42, w);
  float lt = fbm(p * vec2(1.0, 1.8) + vec2(t * sp * 0.5, 0.45));
  return vec2(d, lt);
}
void main(){
  vec2 css = gl_FragCoord.xy / uDpr;
  float yt = uSize.y - css.y;
  vec2 pos = vec2(css.x, yt);
  float t = uTime;
  float a = yt / uAtm;
  vec3 cream = vec3(0.982, 0.956, 0.900);

  // 1. атмосфера: из космоса (прозрачно) в голубое свечение и дальше в тёплое небо
  vec3 hi = vec3(0.30, 0.52, 0.90), mid = vec3(0.70, 0.83, 0.96);
  vec3 sky = mix(hi, mid, smoothstep(0.0, 0.5, a));
  sky = mix(sky, cream, smoothstep(0.45, 0.98, a));
  float skyA = pow(smoothstep(0.0, 0.7, a), 1.7);
  float limb = exp(-pow((a - 0.16) / 0.12, 2.0)) * smoothstep(0.0, 0.14, a);
  vec3 col = sky * skyA + vec3(0.55, 0.75, 1.0) * limb * 0.38;
  float A = clamp(skyA + limb * 0.38 * (1.0 - skyA), 0.0, 1.0);

  // 2. картина
  float y0 = uAtm * 0.8;
  vec2 rect = vec2(uSize.x, uSize.y - y0);
  float sc = max(rect.x / uImg.x, rect.y / uImg.y);
  vec2 disp = uImg * sc;
  vec2 off = vec2((disp.x - rect.x) * 0.5, (disp.y - rect.y) * 0.12);
  vec2 uvT = vec2(pos.x + off.x, pos.y - y0 + off.y) / disp;
  float imgA = uReady * smoothstep(uAtm * 0.62, uAtm * 0.98, yt);
  vec3 img = texture2D(uTex, clamp(uvT, 0.002, 0.998)).rgb;
  float lum = dot(img, vec3(0.299, 0.587, 0.114));
  float sat = max(img.r, max(img.g, img.b)) - min(img.r, min(img.g, img.b));
  float land = smoothstep(0.25, 0.38, uvT.y);
  float s = 0.5 + 0.5 * sin(t * 0.42);                         // цикл света
  float sun = mix(0.55, 1.0, smoothstep(0.2, 1.0, uvT.x));     // солнце справа

  img = mix(img, img * mix(vec3(0.78, 0.87, 0.97), vec3(1.06, 1.01, 0.90), s), land);
  float fol = smoothstep(0.0, 0.10, img.g - img.b) * smoothstep(0.18, 0.5, lum);
  img += vec3(1.0, 0.82, 0.32) * fol * (0.05 + 0.28 * s) * sun * land;

  float md = length(pos - uMouse) / (uSize.y * 0.30);          // свет от курсора
  float ml = exp(-md * md * 2.2) * uMouseOn;
  img += vec3(1.0, 0.90, 0.60) * ml * (0.10 + fol * 0.28) * land;

  float rv = smoothstep(0.40, 0.44, uvT.y) * (1.0 - smoothstep(0.62, 0.68, uvT.y)) * smoothstep(0.38, 0.52, uvT.x)
           * smoothstep(0.44, 0.62, lum) * (1.0 - smoothstep(0.10, 0.22, sat));
  vec2 gc = floor(pos / 3.0);
  float gh = hash(gc);
  float glint = step(0.90, gh) * pow(max(0.0, sin(t * (1.4 + gh * 3.0) + gh * 50.0)), 14.0) * rv;
  img += vec3(1.0, 0.95, 0.8) * (glint * 1.3 + rv * s * 0.12);

  vec2 sp = vec2(0.82 + 0.05 * sin(t * 0.2), 0.27);
  vec2 dd = (uvT - sp) * vec2(1.5, 1.0);
  img += vec3(1.0, 0.8, 0.5) * exp(-dot(dd, dd) * 7.0) * (0.12 + 0.38 * s) * 0.42;

  float dotp = length(fract(pos / 4.0) - 0.5);                  // лёгкий растр, как на референсе
  img *= 1.0 - 0.05 * smoothstep(0.22, 0.5, dotp) * land;
  img *= 1.0 - 0.28 * smoothstep(0.6, 1.0, yt / uSize.y);

  col = img * imgA + col * (1.0 - imgA);
  A = imgA + A * (1.0 - imgA);

  // 3. облака: три слоя, плывут с разной скоростью, мышь даёт параллакс
  vec2 q = pos / uAtm;
  vec2 ms = (uMouse / uSize - 0.5) * uMouseOn;
  float cov = 0.38 + 0.30 * smoothstep(0.0, 0.9, a);
  vec3 cShade = vec3(0.74, 0.80, 0.92), cLit = vec3(1.0, 0.985, 0.96);
  vec2 l1 = cloudL(q + vec2(ms.x * 0.05, 0.0), 1.7, 0.006, 3.0, cov, t);
  float w1 = smoothstep(0.08, 0.40, a) * (1.0 - smoothstep(0.95, 1.35, a) * 0.9);
  float ca = l1.x * w1 * 0.85;
  col = mix(cShade, cLit, smoothstep(0.25, 0.75, l1.y)) * ca + col * (1.0 - ca); A = ca + A * (1.0 - ca);
  vec2 l2 = cloudL(q + vec2(ms.x * 0.09, 0.0), 2.4, 0.012, 9.0, cov, t);
  float w2 = smoothstep(0.18, 0.55, a) * (1.0 - smoothstep(1.0, 1.4, a) * 0.85);
  ca = l2.x * w2 * 0.85;
  col = mix(cShade, cLit, smoothstep(0.25, 0.75, l2.y)) * ca + col * (1.0 - ca); A = ca + A * (1.0 - ca);
  vec2 l3 = cloudL(q + vec2(ms.x * 0.15, 0.0), 1.15, 0.020, 21.0, cov + 0.04, t);
  float w3 = smoothstep(0.30, 0.70, a) * (1.0 - smoothstep(1.05, 1.5, a) * 0.9);
  ca = l3.x * w3 * 0.9;
  col = mix(cShade, cLit, smoothstep(0.2, 0.7, l3.y)) * ca + col * (1.0 - ca); A = ca + A * (1.0 - ca);

  A = clamp(A, 0.0, 1.0);
  col = min(col, vec3(A));
  gl_FragColor = vec4(col, A);
}`;
    const compile = (type, s) => { const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error('earth-live:', gl.getShaderInfoLog(sh)); return null; } return sh; };
    const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('earth-live:', gl.getProgramInfoLog(prog)); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(aLoc); gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    const L = n => gl.getUniformLocation(prog, n);
    const U = { size: L('uSize'), dpr: L('uDpr'), atm: L('uAtm'), time: L('uTime'), ready: L('uReady'), mouse: L('uMouse'), mouseOn: L('uMouseOn'), img: L('uImg'), tex: L('uTex') };
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0);

    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([250, 244, 230, 255]));
    let ready = 0, imgW = 1642, imgH = 958;
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        imgW = im.naturalWidth; imgH = im.naturalHeight; ready = 1;
        section.classList.add('live'); resize(); draw();
      } catch (err) { console.warn('earth-live: не удалось загрузить картинку в WebGL', err); }
    };
    im.src = fallback ? (fallback.currentSrc || fallback.src) : '';

    let cssW = 1, cssH = 1, dpr = 1, mx = 0, my = 0, mOn = 0, mTarget = 0, visible = false, raf = 0, lastT = 0;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = Math.max(section.clientWidth, 1); cssH = Math.max(section.clientHeight, 1);
      const w = Math.floor(cssW * dpr), h = Math.floor(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (ready && (reduce || !raf)) draw();
    };
    const draw = () => {
      const now = performance.now() / 1000;
      const dt = Math.min(now - (lastT || now), .1); lastT = now;
      mOn += (mTarget - mOn) * (1 - Math.exp(-dt * 4));
      const atm = parseFloat(getComputedStyle(section).getPropertyValue('--atm')) || 400;
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.tex, 0);
      gl.uniform2f(U.size, cssW, cssH); gl.uniform1f(U.dpr, canvas.width / cssW);
      gl.uniform1f(U.atm, section.querySelector('.earth-text').offsetTop / .8 || atm);
      gl.uniform1f(U.time, reduce ? 6 : now); gl.uniform1f(U.ready, ready);
      gl.uniform2f(U.mouse, mx, my); gl.uniform1f(U.mouseOn, reduce ? 0 : mOn); gl.uniform2f(U.img, imgW, imgH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = () => { draw(); raf = (visible && !document.hidden) ? requestAnimationFrame(loop) : 0; };
    const wake = () => { if (!reduce && !raf && visible && !document.hidden) raf = requestAnimationFrame(loop); };
    section.addEventListener('pointermove', e => { const r = section.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; mTarget = 1; }, { passive: true });
    section.addEventListener('pointerleave', () => { mTarget = 0; });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); wake(); }).observe(section);
    else { visible = true; wake(); }
    document.addEventListener('visibilitychange', wake);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(section); else window.addEventListener('resize', resize, { passive: true });
    resize();
  })();

  // Hyperdrive: звёзды летят к зрителю, скорость реагирует на положение мыши.
  (() => {
    const canvas=document.getElementById('hyperdrive-stars');if(!canvas)return;const ctx=canvas.getContext('2d');let w=0,h=0,stars=[],raf=0,speed=2;const count=800;
    const resize=()=>{const dpr=Math.min(devicePixelRatio||1,2);w=canvas.clientWidth;h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);stars=Array.from({length:count},()=>{const z=Math.random()*w+1;return{x:Math.random()*w-w/2,y:Math.random()*h-h/2,z,pz:z};});};
    const draw=()=>{ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';for(const s of stars){s.z-=speed;if(s.z<1){s.x=Math.random()*w-w/2;s.y=Math.random()*h-h/2;s.z=w;s.pz=s.z;}const sx=s.x/s.z*w/2+w/2,sy=s.y/s.z*h/2+h/2,px=s.x/s.pz*w/2+w/2,py=s.y/s.pz*h/2+h/2;const r=Math.max(.1,(1-s.z/w)*2.5);s.pz=s.z;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(sx,sy);ctx.lineWidth=r*2;ctx.strokeStyle=`rgba(255,255,255,${1-s.z/w})`;ctx.stroke();}raf=requestAnimationFrame(draw);};
    const move=e=>{const dist=Math.abs(e.clientX-w/2);speed=2+(1-dist/(w/2))*20;};resize();draw();window.addEventListener('resize',()=>{cancelAnimationFrame(raf);resize();draw()},{passive:true});canvas.parentElement.addEventListener('pointermove',move,{passive:true});canvas.parentElement.addEventListener('pointerleave',()=>speed=2,{passive:true});
  })();

  // Звёздное поле первого экрана.
  (() => {
    const canvas = document.getElementById('starfield'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0, height = 0, stars = [], raf = 0;
    const count = Math.min(260, Math.floor((window.innerWidth * window.innerHeight) / 6500));
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({length: count}, () => ({x:Math.random()*width,y:Math.random()*height,r:Math.random()*1.35+.2,a:Math.random()*.7+.2,s:Math.random()*.22+.04,p:Math.random()*Math.PI*2}));
    };
    const draw = (time=0) => {
      ctx.clearRect(0,0,width,height);
      for (const star of stars) {
        const twinkle = reduceMotion ? 1 : .65 + Math.sin(time*.0007 + star.p)*.35;
        ctx.beginPath(); ctx.arc(star.x,star.y,star.r,0,Math.PI*2);
        ctx.fillStyle = `rgba(225,232,255,${star.a*twinkle})`; ctx.fill();
        if (!reduceMotion) { star.y += star.s; if(star.y > height){star.y=0;star.x=Math.random()*width;} }
      }
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };
    resize(); draw();
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); resize(); draw(); }, {passive:true});
  })();

  // Шапка становится плотнее при прокрутке.
  const topbar = document.getElementById('topbar');
  const updateHeader = () => topbar && topbar.classList.toggle('scrolled', window.scrollY > 30);
  window.addEventListener('scroll', updateHeader, {passive:true}); updateHeader();

  // Мобильное меню.
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');
  menuToggle?.addEventListener('click', () => {
    const opened = navLinks.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(opened));
    menuToggle.textContent = opened ? '×' : '☰';
  });
  navLinks?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    navLinks.classList.remove('open'); menuToggle?.setAttribute('aria-expanded','false');
    if(menuToggle) menuToggle.textContent = '☰';
  }));

  // Плавное появление блоков при входе в область просмотра.
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => { if(entry.isIntersecting){entry.target.classList.add('visible');obs.unobserve(entry.target);} });
    }, {threshold:.12,rootMargin:'0px 0px -35px 0px'});
    revealItems.forEach(item => observer.observe(item));
  } else revealItems.forEach(item => item.classList.add('visible'));
