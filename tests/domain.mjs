import assert from "node:assert/strict";
import {
  defaults,
  run,
  truth,
  price,
  characteristic,
  decode,
  fit,
  targets,
  loss,
  surface,
} from "../web/src/model.js";
let n = 0;
const ok = (x) => {
  assert.ok(x);
  n++;
};
for (let i = 0; i < 64; i++) {
  let p = decode(
    Array.from({ length: 5 }, (_, j) => ((i * 37 + j * 17) % 101) / 100),
  );
  for (let t of [0.25, 0.5, 1, 1.5, 2]) {
    let prices = [80, 90, 100, 110, 120].map((k) => price(p, t, k));
    for (let j = 0; j < 5; j++) {
      ok(Number.isFinite(prices[j]));
      ok(
        prices[j] >=
          Math.max(
            0,
            100 * Math.exp(-0.01 * t) - (80 + j * 10) * Math.exp(-0.02 * t),
          ) -
            1e-7,
      );
      if (j) ok(prices[j] <= prices[j - 1]);
      if (j >= 2) ok(prices[j] - 2 * prices[j - 1] + prices[j - 2] >= -1e-7);
      ok(Math.abs(prices[j] - price(p, t, 80 + j * 10, true)) < 1e-6);
    }
    for (let u of [0.1, 1, 10, 100]) {
      let a = characteristic(p, u, 0, t),
        b = characteristic(p, -u, 0, t);
      ok(Math.abs(a.re - b.re) < 1e-13);
      ok(Math.abs(a.im + b.im) < 1e-13);
      ok(Math.hypot(a.re, a.im) <= 1 + 1e-12);
    }
  }
}
for (let k of ["surface", "noise", "seed"])
  for (let v of [NaN, Infinity, null, "1", -1])
    assert.throws(() => run({ ...defaults, [k]: v }));
for (let c of [
  { surface: 1.2 },
  { surface: 3 },
  { noise: 101 },
  { seed: 0 },
  { seed: 10000 },
  { seed: 1.2 },
])
  assert.throws(() => run({ ...defaults, ...c }));
for (let x of [
  new Array(5),
  [0, 0, 0, 0],
  [-0.1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1.1],
])
  assert.throws(() => decode(x));
for (let y of [
  new Array(15),
  Array(14).fill(1),
  Array(15).fill(-1),
  Array(15).fill(NaN),
])
  assert.throws(() => fit(y, 0));
let y = targets(defaults),
  copy = [...y],
  f = fit(y, 0);
y[0] = 99;
ok(Math.abs(f.loss - loss(f.params, copy)) < 1e-13);
ok(loss(truth(0), targets({ ...defaults, noise: 0 })) === 0);
ok(
  JSON.stringify(targets({ ...defaults, noise: 0, seed: 1 })) ===
    JSON.stringify(surface(truth(0))),
);
console.log(
  `${n} JS domain/pricing/ownership checks plus invalid cases passed`,
);
