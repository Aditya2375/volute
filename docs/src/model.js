export const defaults = { surface: 0, noise: 20, seed: 17 };
const LOW = [0.02, 0.6, 0.02, 0.15, -0.85],
  HIGH = [0.09, 3.5, 0.09, 0.75, -0.15];
const EXPIRIES = [0.25, 1, 2],
  STRIKES = [80, 90, 100, 110, 120],
  EDGES = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256];
const STARTS = [
  [0.3, 0.3, 0.3, 0.3, 0.3],
  [0.7, 0.65, 0.6, 0.7, 0.2],
  [0.5, 0.8, 0.2, 0.3, 0.8],
];
export function validate(c) {
  if (
    !c ||
    !Number.isInteger(c.surface) ||
    c.surface < 0 ||
    c.surface > 2 ||
    !Number.isFinite(c.noise) ||
    c.noise < 0 ||
    c.noise > 100 ||
    !Number.isInteger(c.seed) ||
    c.seed < 1 ||
    c.seed > 9999
  )
    throw Error(
      "Surface 0..2, relative noise 0..100 bps, integer seed 1..9999 required",
    );
}
export function validateParams(p) {
  if (!p) throw Error("Parameters required");
  [p.v0, p.kappa, p.theta, p.sigma, p.rho].forEach((x, i) => {
    if (!Number.isFinite(x) || x < LOW[i] || x > HIGH[i])
      throw Error("Parameters outside declared pricing box");
  });
}
export function truth(surface) {
  let a = [
    [0.045, 1.7, 0.05, 0.42, -0.62],
    [0.07, 0.9, 0.032, 0.6, -0.78],
    [0.025, 2.8, 0.065, 0.25, -0.3],
  ][surface];
  if (!Number.isInteger(surface) || !a) throw Error("Surface 0..2 required");
  return Object.fromEntries(
    ["v0", "kappa", "theta", "sigma", "rho"].map((k, i) => [k, a[i]]),
  );
}
export function decode(x) {
  if (
    !Array.isArray(x) ||
    x.length !== 5 ||
    Array.from(
      { length: 5 },
      (_, i) => !Number.isFinite(x[i]) || x[i] < 0 || x[i] > 1,
    ).some(Boolean)
  )
    throw Error("Five coordinates in 0..1 required");
  let a = x.map((v, i) => LOW[i] + v * (HIGH[i] - LOW[i]));
  return Object.fromEntries(
    ["v0", "kappa", "theta", "sigma", "rho"].map((k, i) => [k, a[i]]),
  );
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  scale = (a, s) => [a[0] * s, a[1] * s],
  div = (a, b) => {
    let d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  },
  exp = (a) => {
    let e = Math.exp(a[0]);
    return [e * Math.cos(a[1]), e * Math.sin(a[1])];
  },
  log = (a) => [Math.log(Math.hypot(...a)), Math.atan2(a[1], a[0])],
  sqrt = (a) => {
    let h = Math.hypot(...a);
    return [
      Math.sqrt((h + a[0]) / 2),
      (a[1] < 0 || Object.is(a[1], -0) ? -1 : 1) *
        Math.sqrt(Math.max(0, (h - a[0]) / 2)),
    ];
  };
function cf(p, u, imaginary, t) {
  let z = [u, imaginary],
    iz = [-imaginary, u],
    b = sub([p.kappa, 0], scale(iz, p.rho * p.sigma)),
    d = sqrt(add(mul(b, b), scale(add(mul(z, z), iz), p.sigma * p.sigma))),
    g = div(sub(b, d), add(b, d)),
    e = exp(scale(d, -t)),
    den = sub([1, 0], mul(g, e)),
    c = scale(
      sub(scale(sub(b, d), t), scale(log(div(den, sub([1, 0], g))), 2)),
      (p.kappa * p.theta) / (p.sigma * p.sigma),
    ),
    v = scale(
      mul(scale(sub(b, d), 1 / (p.sigma * p.sigma)), div(sub([1, 0], e), den)),
      p.v0,
    );
  return exp(add(c, v));
}
export function characteristic(p, u, imaginary, t) {
  validateParams(p);
  if (
    !Number.isFinite(u) ||
    Math.abs(u) > 512 ||
    !Number.isFinite(imaginary) ||
    imaginary < -0.5 ||
    imaginary > 0 ||
    !Number.isFinite(t) ||
    t < 0.25 ||
    t > 2
  )
    throw Error("CF outside supported domain");
  let a = cf(p, u, imaginary, t);
  return { re: a[0], im: a[1] };
}
function quadrature(n, upper) {
  let a = [],
    edges = [...EDGES];
  for (let e = 288; e <= 512; e += 32) edges.push(e);
  for (let e = 576; e <= upper; e += 64) edges.push(e);
  for (let panel = 0; panel < edges.length - 1; panel++) {
    let mid = (edges[panel] + edges[panel + 1]) / 2,
      half = (edges[panel + 1] - edges[panel]) / 2;
    for (let i = 0; i < n; i++) {
      let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)),
        dp = 0;
      for (let it = 0; it < 30; it++) {
        let p0 = 1,
          p1 = z;
        for (let j = 2; j <= n; j++) {
          let p2 = ((2 * j - 1) * z * p1 - (j - 1) * p0) / j;
          p0 = p1;
          p1 = p2;
        }
        dp = (n * (z * p1 - p0)) / (z * z - 1);
        let next = z - p1 / dp;
        if (Math.abs(next - z) < 1e-15) {
          z = next;
          break;
        }
        z = next;
      }
      let p0 = 1,
        p1 = z;
      for (let j = 2; j <= n; j++) {
        let p2 = ((2 * j - 1) * z * p1 - (j - 1) * p0) / j;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      a.push([mid + half * z, (half * 2) / ((1 - z * z) * dp * dp)]);
    }
  }
  return a.sort((a, b) => a[0] - b[0]);
}
const QUAD = quadrature(16, 1024),
  FINE = quadrature(32, 2048);
function prices(p, t, strikes, fine) {
  let sums = strikes.map(() => 0);
  for (let [u, w] of fine ? FINE : QUAD) {
    let phi = cf(p, u, -0.5, t);
    for (let j = 0; j < strikes.length; j++) {
      let phase = u * (Math.log(100 / strikes[j]) + 0.01 * t);
      sums[j] +=
        (w * (Math.cos(phase) * phi[0] - Math.sin(phase) * phi[1])) /
        (u * u + 0.25);
    }
  }
  return sums.map((v, j) => {
    let c =
      100 * Math.exp(-0.01 * t) -
      (Math.sqrt(100 * strikes[j]) * Math.exp(-0.015 * t) * v) / Math.PI;
    if (
      !Number.isFinite(c) ||
      c <
        Math.max(
          0,
          100 * Math.exp(-0.01 * t) - strikes[j] * Math.exp(-0.02 * t),
        ) -
          1e-7 ||
      c > 100 * Math.exp(-0.01 * t) + 1e-7
    )
      throw Error("Pricing integral violates call bounds");
    return c;
  });
}
export function price(p, t, strike, fine = false) {
  validateParams(p);
  if (
    !Number.isFinite(t) ||
    t < 0.25 ||
    t > 2 ||
    !Number.isFinite(strike) ||
    strike < 80 ||
    strike > 120
  )
    throw Error("Pricing T 0.25..2, K 80..120 required");
  return prices(p, t, [strike], fine)[0];
}
export function surface(p) {
  validateParams(p);
  return EXPIRIES.flatMap((t) => prices(p, t, STRIKES, false));
}
export function targets(c) {
  validate(c);
  let a = surface(truth(c.surface)),
    s = c.seed;
  return a.map((v) => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return v * (1 + (c.noise / 10000) * ((2 * s) / 4294967296 - 1));
  });
}
function objective(p, y) {
  let a = surface(p),
    l = 0;
  for (let i = 0; i < 15; i++) l += ((a[i] - y[i]) * (a[i] - y[i])) / 15;
  return l;
}
function validateTargets(y) {
  if (
    !Array.isArray(y) ||
    y.length !== 15 ||
    Array.from(
      { length: 15 },
      (_, i) => !Number.isFinite(y[i]) || y[i] < 0 || y[i] > 100,
    ).some(Boolean)
  )
    throw Error("15 finite target prices in 0..100 required");
}
export function loss(p, y) {
  validateTargets(y);
  return objective(p, y);
}
function bounded(c, w, scale) {
  return c.map((v, j) => Math.max(0, Math.min(1, v + scale * (v - w[j]))));
}
export function fit(targets, start) {
  if (!Number.isInteger(start) || start < 0 || start > 2)
    throw Error("Start 0..2 required");
  validateTargets(targets);
  let y = [...targets],
    v = [],
    evaluations = 0;
  for (let i = 0; i < 6; i++) {
    let x = [...STARTS[start]];
    if (i > 0) x[i - 1] += 0.08;
    v.push({ x, value: objective(decode(x), y) });
    evaluations++;
  }
  let initialLoss = v[0].value,
    trace = [],
    converged = false,
    iter = 0;
  for (; iter < 350; iter++) {
    v.sort((a, b) => a.value - b.value);
    trace.push(v[0].value);
    let diameter = 0;
    for (let i = 1; i < 6; i++)
      for (let j = 0; j < 5; j++)
        diameter = Math.max(diameter, Math.abs(v[i].x[j] - v[0].x[j]));
    if (diameter < 2e-5 && v[5].value - v[0].value < 1e-10) {
      converged = true;
      break;
    }
    let c = Array(5).fill(0);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) c[j] += v[i].x[j] / 5;
    let xr = bounded(c, v[5].x, 1),
      reflected = { x: xr, value: objective(decode(xr), y) };
    evaluations++;
    if (reflected.value < v[0].value) {
      let xe = bounded(c, v[5].x, 2),
        expanded = { x: xe, value: objective(decode(xe), y) };
      evaluations++;
      v[5] = expanded.value < reflected.value ? expanded : reflected;
    } else if (reflected.value < v[4].value) v[5] = reflected;
    else {
      let outside = reflected.value < v[5].value,
        xc = bounded(c, outside ? reflected.x : v[5].x, -0.5),
        contracted = { x: xc, value: objective(decode(xc), y) };
      evaluations++;
      if (contracted.value < (outside ? reflected.value : v[5].value))
        v[5] = contracted;
      else
        for (let i = 1; i < 6; i++) {
          let xs = v[0].x.map((a, j) => (a + v[i].x[j]) / 2);
          v[i] = { x: xs, value: objective(decode(xs), y) };
          evaluations++;
        }
    }
  }
  v.sort((a, b) => a.value - b.value);
  if (!trace.length || trace.at(-1) !== v[0].value) trace.push(v[0].value);
  let boundary = v[0].x.filter((x) => x <= 1e-5 || x >= 1 - 1e-5).length;
  return {
    start,
    initial: decode(STARTS[start]),
    params: decode(v[0].x),
    initialLoss,
    loss: v[0].value,
    iterations: iter,
    evaluations,
    converged,
    boundary,
    trace,
  };
}
export function run(c) {
  validate(c);
  c = { surface: c.surface, noise: c.noise, seed: c.seed };
  let y = targets(c),
    clean = surface(truth(c.surface)),
    fits = [0, 1, 2].map((i) => fit(y, i)),
    best = 0;
  for (let i = 1; i < 3; i++) if (fits[i].loss < fits[best].loss) best = i;
  let p = fits[best].params,
    a = surface(p),
    quotes = [],
    max = 0,
    gap = 0,
    i = 0;
  for (let maturity of EXPIRIES)
    for (let strike of STRIKES) {
      quotes.push({
        maturity,
        strike,
        clean: clean[i],
        target: y[i],
        fitted: a[i],
        calibration: true,
      });
      max = Math.max(max, Math.abs(a[i] - y[i]));
      gap = Math.max(gap, Math.abs(price(p, maturity, strike, true) - a[i]));
      i++;
    }
  let holdout = 0;
  for (let maturity of [0.5, 1.5])
    for (let strike of [85, 100, 115]) {
      let truthPrice = price(truth(c.surface), maturity, strike),
        fp = price(p, maturity, strike);
      quotes.push({
        maturity,
        strike,
        clean: truthPrice,
        target: truthPrice,
        fitted: fp,
        calibration: false,
      });
      holdout += ((fp - truthPrice) * (fp - truthPrice)) / 6;
      gap = Math.max(gap, Math.abs(price(p, maturity, strike, true) - fp));
    }
  return {
    config: c,
    truth: truth(c.surface),
    fits,
    selected: best,
    quotes,
    rmse: Math.sqrt(fits[best].loss),
    holdoutRmse: Math.sqrt(holdout),
    maxError: max,
    feller: 2 * p.kappa * p.theta - p.sigma * p.sigma,
    quadratureGap: gap,
  };
}
