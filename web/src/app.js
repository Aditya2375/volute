import { defaults, validate } from "./model.js";
const $ = (id) => document.getElementById(id),
  f = (x, n = 6) =>
    x !== 0 && Math.abs(x) < 1e-6 ? x.toExponential(3) : x.toFixed(n);
let applied = null,
  pending = false,
  quote = 8,
  expiry = 1,
  serial = 0;
const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});
function readConfig() {
  let c = {};
  for (let k of ["surface", "noise", "seed"]) {
    if (!$(k).value.trim()) throw Error("All controls required");
    c[k] = Number($(k).value);
  }
  validate(c);
  return c;
}
function status() {
  let c = applied.config,
    dirty = false;
  try {
    dirty = JSON.stringify(readConfig()) !== JSON.stringify(c);
  } catch {
    dirty = true;
  }
  $("status").className = "";
  $("status").textContent =
    `APPLIED / surface ${c.surface + 1} · relative noise ${c.noise} bps · seed ${c.seed}${dirty ? " / EDITING: controls differ; results retained." : ""}`;
}
function dl(id, items) {
  $(id).replaceChildren(
    ...items.map(([a, b]) => {
      let div = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = a;
      dd.textContent = b;
      div.append(dt, dd);
      return div;
    }),
  );
}
function el(svg, tag, attrs, text) {
  let e = document.createElementNS(svg.namespaceURI, tag);
  for (let [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  svg.append(e);
  return e;
}
function charts() {
  if (!applied) return;
  let svg = $("prices"),
    rows = applied.quotes.filter((q) => q.calibration && q.maturity === expiry),
    w = svg.clientWidth,
    h = w < 500 ? 300 : 340;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();
  let hi = Math.max(...rows.flatMap((q) => [q.target, q.fitted])) + 2,
    X = (k) => 48 + ((k - 80) / 40) * (w - 66),
    Y = (v) => 22 + ((hi - v) / hi) * (h - 70);
  for (let v of [0, hi / 2, hi]) {
    el(svg, "line", { x1: 48, x2: w - 18, y1: Y(v), y2: Y(v), class: "grid" });
    el(
      svg,
      "text",
      { x: 40, y: Y(v) + 4, "text-anchor": "end", class: "axis" },
      f(v, 1),
    );
  }
  for (let k of [80, 100, 120])
    el(
      svg,
      "text",
      {
        x: X(k),
        y: h - 28,
        "text-anchor": k === 80 ? "start" : k === 120 ? "end" : "middle",
        class: "axis",
      },
      String(k),
    );
  el(
    svg,
    "text",
    { x: 48, y: h - 8, class: "axis" },
    "STRIKE / CALL PRICE UNITS",
  );
  el(svg, "path", {
    d: rows
      .map((q, i) => (i ? "L" : "M") + X(q.strike) + "," + Y(q.fitted))
      .join(""),
    class: "fit-line",
  });
  for (let q of rows) {
    el(svg, "line", {
      x1: X(q.strike),
      x2: X(q.strike),
      y1: Y(q.target),
      y2: Y(q.fitted),
      class: "miss-line",
    });
    el(svg, "circle", {
      cx: X(q.strike),
      cy: Y(q.target),
      r: 5,
      class: "target-dot",
    });
    el(svg, "circle", {
      cx: X(q.strike),
      cy: Y(q.fitted),
      r: 2,
      class: "price-dot",
    });
  }
  svg = $("lossplot");
  w = svg.clientWidth;
  h = w < 500 ? 260 : 300;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();
  let t = applied.fits[applied.selected].trace,
    logs = t.map((v) => Math.log10(Math.max(1e-16, v))),
    lo = Math.floor(Math.min(...logs)) - 1,
    top = Math.ceil(Math.max(...logs)) + 1,
    xx = (i) => 48 + (i / Math.max(1, t.length - 1)) * (w - 66),
    yy = (v) => 22 + ((top - v) / (top - lo)) * (h - 70);
  for (let v of [lo, (lo + top) / 2, top]) {
    el(svg, "line", {
      x1: 48,
      x2: w - 18,
      y1: yy(v),
      y2: yy(v),
      class: "grid",
    });
    el(
      svg,
      "text",
      { x: 40, y: yy(v) + 4, "text-anchor": "end", class: "axis" },
      v.toFixed(1),
    );
  }
  for (let i of [0, Math.floor((t.length - 1) / 2), t.length - 1])
    el(
      svg,
      "text",
      {
        x: xx(i),
        y: h - 28,
        "text-anchor":
          i === 0 ? "start" : i === t.length - 1 ? "end" : "middle",
        class: "axis",
      },
      String(i),
    );
  el(svg, "text", { x: 48, y: h - 8, class: "axis" }, "ITERATION / LOG10 MSE");
  el(svg, "path", {
    d: logs.map((v, i) => (i ? "L" : "M") + xx(i) + "," + yy(v)).join(""),
    class: "loss-line",
  });
}
function inspect() {
  if (!applied) return;
  let q = applied.quotes[quote - 1];
  $("selection").className = "selection";
  $("selection").textContent =
    `Quote ${quote} / ${q.calibration ? "CALIBRATION: perturbed target enters search" : "WITHHELD: clean target never enters search"}`;
  dl("quote-audit", [
    ["Quote / one-based", String(quote)],
    ["Use", q.calibration ? "Fit" : "Withheld"],
    ["Expiry / years", f(q.maturity, 2)],
    ["Strike / price units", f(q.strike, 2)],
    ["Clean synthetic price", f(q.clean)],
    ["Target price", f(q.target)],
  ]);
  dl("error-audit", [
    ["Fitted price", f(q.fitted)],
    ["Fit − target / price units", f(q.fitted - q.target)],
    ["Squared price residual", f((q.fitted - q.target) ** 2)],
    ["Relative target noise / bps", f((q.target / q.clean - 1) * 10000)],
    [
      "Contribution to fit MSE",
      q.calibration ? f((q.fitted - q.target) ** 2 / 15) : "Excluded",
    ],
    ["Clean-price error", f(q.fitted - q.clean)],
  ]);
  for (let tr of $("ledger").children)
    tr.className = Number(tr.cells[0].textContent) === quote ? "selected" : "";
}
function render() {
  let r = applied,
    b = r.fits[r.selected];
  for (let [k, v] of Object.entries({
    rmse: r.rmse,
    holdout: r.holdoutRmse,
    maxerror: r.maxError,
    gap: r.quadratureGap,
  }))
    $(k).textContent = f(v, 4);
  $("fit-summary").textContent =
    `Start ${r.selected + 1} has the lowest final MSE ${f(b.loss)}. ${b.converged ? "Simplex stopping tolerances met." : "Iteration budget reached; no convergence claim."} ${b.boundary} parameter(s) within 10⁻⁵ of a normalized box boundary.`;
  let specs = [
    ["v0", "Initial variance v₀", "annualized variance / 0.02 to 0.09"],
    ["kappa", "Reversion speed κ", "per year / 0.6 to 3.5"],
    ["theta", "Long-run variance θ", "annualized variance / 0.02 to 0.09"],
    ["sigma", "Volatility of variance ξ", "per year / 0.15 to 0.75"],
    ["rho", "Shock correlation ρ", "dimensionless / −0.85 to −0.15"],
  ];
  $("parameters").replaceChildren(
    ...specs.map(([k, title, units]) => {
      let row = document.createElement("div");
      row.className = "parameter";
      let label = document.createElement("div"),
        h = document.createElement("h3"),
        small = document.createElement("small"),
        a = document.createElement("strong"),
        fit = document.createElement("strong");
      h.textContent = title;
      small.textContent = units;
      a.textContent = f(r.truth[k]);
      fit.textContent = f(b.params[k]);
      label.append(h, small);
      row.append(label, a, fit);
      return row;
    }),
  );
  $("feller").textContent =
    `Selected fit: 2κθ − ξ² = ${f(r.feller)}. ${r.feller > 0 ? "Strict sufficient positivity condition met." : "Strict sufficient positivity condition not met."}`;
  $("starts").replaceChildren(
    ...r.fits.map((x, i) => {
      let div = document.createElement("div");
      div.className = "start" + (i === r.selected ? " chosen" : "");
      let h = document.createElement("h3");
      h.textContent = `Start ${i + 1}${i === r.selected ? " / selected" : ""}`;
      div.append(h);
      for (let [name, p] of [
        ["Initial", x.initial],
        ["Fitted", x.params],
      ]) {
        const line = document.createElement("p");
        line.className = "start-params";
        line.textContent = `${name} / v₀ ${f(p.v0, 4)} · κ ${f(p.kappa, 4)} · θ ${f(p.theta, 4)} · ξ ${f(p.sigma, 4)} · ρ ${f(p.rho, 4)}`;
        div.append(line);
      }
      let id = "start-audit-" + i,
        list = document.createElement("dl");
      list.id = id;
      div.append(list);
      return div;
    }),
  );
  r.fits.forEach((x, i) =>
    dl("start-audit-" + i, [
      ["Initial MSE", f(x.initialLoss)],
      ["Final MSE", f(x.loss)],
      ["Iterations", String(x.iterations)],
      ["Price-grid evaluations", String(x.evaluations)],
      ["Stop", x.converged ? "Tolerances met" : "Budget cap"],
      ["Boundary count", String(x.boundary)],
    ]),
  );
  $("ledger").replaceChildren(
    ...r.quotes.map((q, i) => {
      let tr = document.createElement("tr");
      for (let v of [
        String(i + 1),
        q.calibration ? "Fit" : "Withheld",
        f(q.maturity, 2),
        f(q.strike, 2),
        f(q.clean),
        f(q.target),
        f(q.fitted),
        f(q.fitted - q.target),
      ]) {
        let td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      return tr;
    }),
  );
  inspect();
  charts();
}
function submit(c) {
  if (pending) return;
  pending = true;
  $("run").disabled = true;
  $("status").className = "";
  $("status").textContent =
    "FITTING / three bounded starts. Previous result stays visible.";
  worker.postMessage({ id: ++serial, config: c });
}
worker.onmessage = ({ data }) => {
  if (data.id !== serial) return;
  pending = false;
  $("run").disabled = false;
  if (data.error) {
    $("status").className = "error";
    $("status").textContent =
      `Not applied: ${data.error}. Previous result retained.`;
    return;
  }
  applied = data.result;
  render();
  status();
};
worker.onerror = () => {
  pending = false;
  $("run").disabled = false;
  $("status").className = "error";
  $("status").textContent =
    "Numerical worker failed. Previous result retained. Reload to retry.";
};
$("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  if (pending) return;
  try {
    submit(readConfig());
  } catch (e) {
    $("status").className = "error";
    $("status").textContent =
      `Not applied: ${e.message}. Previous result retained.`;
  }
});
for (let k of ["surface", "noise", "seed"])
  $(k).addEventListener("input", () => {
    if (pending) return;
    if (applied) status();
  });
$("expiry").addEventListener("change", () => {
  let v = Number($("expiry").value);
  if ([0.25, 1, 2].includes(v)) {
    expiry = v;
    charts();
  }
});
$("quote").addEventListener("change", () => {
  let v = Number($("quote").value);
  if (!$("quote").value.trim() || !Number.isInteger(v) || v < 1 || v > 21) {
    $("selection").className = "selection error";
    $("selection").textContent = "Invalid inspector. Previous quote retained.";
    return;
  }
  quote = v;
  inspect();
});
window.addEventListener("resize", charts);
submit(defaults);
