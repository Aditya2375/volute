import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { run, defaults, price, decode } from "../web/src/model.js";
let checks = 0;
function compare(a, b, path = "root") {
  if (typeof a === "number") {
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
    assert.ok(
      Math.abs(a - b) <= 2e-9 * (1 + Math.abs(b)),
      `${path}: ${a} != ${b}`,
    );
    checks++;
  } else if (Array.isArray(a)) {
    assert.equal(a.length, b.length, path);
    a.forEach((v, i) => compare(v, b[i], path + "." + i));
  } else if (a && typeof a === "object") {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (let k in a) compare(a[k], b[k], path + "." + k);
  } else assert.equal(a, b, path);
}
for (let surface of [0, 1, 2])
  for (let [noise, seed] of [
    [0, 1],
    [20, 17],
    [100, 9999],
  ]) {
    let config = { surface, noise, seed },
      java = JSON.parse(
        execFileSync(
          "java",
          ["-cp", "build/classes", "Dump", surface, noise, seed].map(String),
          { encoding: "utf8" },
        ),
      );
    compare(run(config), java);
  }
for (let mask = 0; mask < 32; mask++) {
  let p = decode(Array.from({ length: 5 }, (_, i) => (mask >> i) & 1));
  for (let [t, k] of [
    [0.25, 80],
    [0.25, 120],
    [2, 80],
    [2, 120],
  ])
    compare(
      price(p, t, k),
      Number(
        execFileSync(
          "java",
          [
            "-cp",
            "build/classes",
            "Dump",
            "price",
            ...Object.values(p),
            t,
            k,
          ].map(String),
          { encoding: "utf8" },
        ),
      ),
    );
}
console.log(
  `${checks} Java/JS full-result and corner-pricer comparisons at scaled2e-9 passed`,
);
