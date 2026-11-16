import { run, defaults } from "../web/src/model.js";
import { spawn } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  mkdtempSync,
} from "node:fs";

const HTTP_PORT = 8998;
const CDP_PORT = 9399;
const SHOTS = process.env.SMOKE_SHOTS === "1";
const root = new URL("..", import.meta.url).pathname;

const profile = mkdtempSync("/tmp/volute-chrome-");
const server = spawn(
  "python3",
  [
    "-m",
    "http.server",
    String(HTTP_PORT),
    "--bind",
    "127.0.0.1",
    "--directory",
    `${root}docs`,
  ],
  { stdio: "ignore", detached: true },
);
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: true },
);

const cleanup = async (code) => {
  for (const child of [chrome, server]) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  await Promise.all(
    [chrome, server].map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => child.once("exit", r)),
    ),
  );
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};
const timeout = setTimeout(() => {
  console.error("smoke: timeout");
  cleanup(1);
}, 120000);
process.on("SIGINT", () => cleanup(2));
process.on("uncaughtException", (e) => {
  console.error(e);
  cleanup(1);
});
process.on("unhandledRejection", (e) => {
  console.error(e);
  cleanup(1);
});

async function waitFor(fn, label, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - start > timeoutMs)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(
    `${ok ? "ok" : "NOT OK"} - ${name}${detail ? " - " + detail : ""}`,
  );
};

await waitFor(
  async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok,
  "chrome devtools",
);
const target = await (
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: "PUT" })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let mid = 0;
const rpcPending = new Map();
const consoleErrors = [];
const requests = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Network.requestWillBeSent")
    requests.push(msg.params.request.url);
  if (msg.id && rpcPending.has(msg.id)) {
    rpcPending.get(msg.id)(msg);
    rpcPending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown")
    consoleErrors.push(
      msg.params.exceptionDetails?.exception?.description ?? "page exception",
    );
};
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++mid;
    rpcPending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const res = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails)
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};
const shot = async (name) => {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 900));
  const metrics = await cdp("Page.getLayoutMetrics");
  const size = metrics.result.cssContentSize;
  const r = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: await evaluate("innerWidth"),
      height: size.height,
      scale: 1,
    },
  });
  writeFileSync(
    `${root}smoke-${name}.png`,
    Buffer.from(r.result.data, "base64"),
  );
};

await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const url = process.env.SMOKE_URL || `http://127.0.0.1:${HTTP_PORT}/`;
await cdp("Page.navigate", { url });
await waitFor(
  async () =>
    await evaluate(
      `document.querySelectorAll('#ledger tr').length===21&&!document.getElementById('run').disabled`,
    ),
  "initial fit",
);
const f = (x, n = 6) =>
    x !== 0 && Math.abs(x) < 1e-6 ? x.toExponential(3) : x.toFixed(n),
  eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cache = new Map();
function result(c) {
  let k = JSON.stringify(c);
  if (!cache.has(k)) cache.set(k, run(c));
  return cache.get(k);
}
const input = (id, v) =>
  evaluate(
    `document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(String(v))};true`,
  );
async function event(id, kind) {
  await evaluate(
    `document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event(${JSON.stringify(kind)},{bubbles:true,cancelable:true}));true`,
  );
}
async function apply(c) {
  for (let [k, v] of Object.entries(c)) await input(k, v);
  await event("controls", "submit");
  await waitFor(
    async () =>
      await evaluate(
        `!document.getElementById('run').disabled&&document.getElementById('status').textContent.startsWith('APPLIED')`,
      ),
    "applied fit",
  );
}
async function inspect(i) {
  await input("quote", i);
  await event("quote", "change");
}
async function expiry(v) {
  await input("expiry", v);
  await event("expiry", "change");
}
async function verify(c, i, e, label) {
  let r = result(c),
    b = r.fits[r.selected],
    q = r.quotes[i - 1];
  let s = await evaluate(
    `(()=>{const t=id=>document.getElementById(id).textContent;return{metrics:['rmse','holdout','maxerror','gap'].map(t),params:[...document.querySelectorAll('.parameter')].map(e=>[...e.querySelectorAll('strong')].map(x=>x.textContent)),starts:[0,1,2].map(i=>[...document.querySelectorAll('#start-audit-'+i+' dd')].map(e=>e.textContent)),prior:[...document.querySelectorAll('#quote-audit dd')].map(e=>e.textContent),post:[...document.querySelectorAll('#error-audit dd')].map(e=>e.textContent),ledger:[...document.querySelectorAll('#ledger tr')].map(e=>[...e.cells].map(x=>x.textContent)),chosen:document.querySelector('#ledger tr.selected')?.cells[0].textContent,price:{w:document.getElementById('prices').clientWidth,view:document.getElementById('prices').getAttribute('viewBox'),path:document.querySelector('#prices path').getAttribute('d'),dots:[...document.querySelectorAll('#prices circle')].map(e=>['cx','cy','r'].map(k=>Number(e.getAttribute(k))))},loss:{w:document.getElementById('lossplot').clientWidth,view:document.getElementById('lossplot').getAttribute('viewBox'),path:document.querySelector('#lossplot path').getAttribute('d')},summary:t('fit-summary'),feller:t('feller')}})()`,
  );
  check(
    label + " metrics",
    eq(
      s.metrics,
      [r.rmse, r.holdoutRmse, r.maxError, r.quadratureGap].map((x) => f(x, 4)),
    ),
  );
  check(
    label + " parameters",
    eq(
      s.params,
      Object.keys(r.truth).map((k) => [f(r.truth[k]), f(b.params[k])]),
    ),
  );
  check(
    label + " starts",
    eq(
      s.starts,
      r.fits.map((x) => [
        f(x.initialLoss),
        f(x.loss),
        String(x.iterations),
        String(x.evaluations),
        x.converged ? "Tolerances met" : "Budget cap",
        String(x.boundary),
      ]),
    ),
  );
  const startText = await evaluate(
    `Array.from(document.querySelectorAll('.start-params'),e=>e.textContent)`,
  );
  check(
    label + " every initial/final parameter caption",
    eq(
      startText,
      r.fits.flatMap((x) =>
        [
          ["Initial", x.initial],
          ["Fitted", x.params],
        ].map(
          ([name, p]) =>
            `${name} / v₀ ${f(p.v0, 4)} · κ ${f(p.kappa, 4)} · θ ${f(p.theta, 4)} · ξ ${f(p.sigma, 4)} · ρ ${f(p.rho, 4)}`,
        ),
      ),
    ),
  );
  check(
    label + " observation audit",
    eq(s.prior, [
      String(i),
      q.calibration ? "Fit" : "Withheld",
      f(q.maturity, 2),
      f(q.strike, 2),
      f(q.clean),
      f(q.target),
    ]),
  );
  check(
    label + " residual audit",
    eq(s.post, [
      f(q.fitted),
      f(q.fitted - q.target),
      f((q.fitted - q.target) ** 2),
      f((q.target / q.clean - 1) * 10000),
      q.calibration ? f((q.fitted - q.target) ** 2 / 15) : "Excluded",
      f(q.fitted - q.clean),
    ]),
  );
  check(
    label + " all ledger cells",
    eq(
      s.ledger,
      r.quotes.map((q, j) => [
        String(j + 1),
        q.calibration ? "Fit" : "Withheld",
        f(q.maturity, 2),
        f(q.strike, 2),
        f(q.clean),
        f(q.target),
        f(q.fitted),
        f(q.fitted - q.target),
      ]),
    ),
  );
  check(label + " selected quote", s.chosen === String(i));
  check(
    label + " fit status",
    s.summary.includes("Start " + (r.selected + 1)) &&
      s.summary.includes(b.converged ? "tolerances met" : "budget reached"),
  );
  check(
    label + " feller",
    s.feller.includes(f(r.feller)) &&
      s.feller.includes(r.feller > 0 ? "condition met" : "condition not met"),
  );
  let rows = r.quotes.filter((q) => q.calibration && q.maturity === e),
    w = s.price.w,
    h = w < 500 ? 300 : 340,
    hi = Math.max(...rows.flatMap((q) => [q.target, q.fitted])) + 2,
    X = (k) => 48 + ((k - 80) / 40) * (w - 66),
    Y = (v) => 22 + ((hi - v) / hi) * (h - 70),
    path = rows
      .map((q, j) => (j ? "L" : "M") + X(q.strike) + "," + Y(q.fitted))
      .join("");
  check(label + " price viewbox", s.price.view === `0 0 ${w} ${h}`);
  const coords = (p) =>
    p.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) || [];
  const close = (a, b) =>
    a.length === b.length && a.every((v, j) => Math.abs(v - b[j]) < 1e-7);
  check(label + " price curve", close(coords(s.price.path), coords(path)));
  check(
    label + " price/target dots",
    close(
      s.price.dots.flat(),
      rows.flatMap((q) => [
        X(q.strike),
        Y(q.target),
        5,
        X(q.strike),
        Y(q.fitted),
        2,
      ]),
    ),
  );
  w = s.loss.w;
  h = w < 500 ? 260 : 300;
  let logs = b.trace.map((v) => Math.log10(Math.max(1e-16, v))),
    lo = Math.floor(Math.min(...logs)) - 1,
    top = Math.ceil(Math.max(...logs)) + 1,
    xx = (j) => 48 + (j / Math.max(1, logs.length - 1)) * (w - 66),
    yy = (v) => 22 + ((top - v) / (top - lo)) * (h - 70);
  path = logs.map((v, j) => (j ? "L" : "M") + xx(j) + "," + yy(v)).join("");
  check(label + " loss viewbox", s.loss.view === `0 0 ${w} ${h}`);
  check(label + " full loss curve", close(coords(s.loss.path), coords(path)));
}
await verify(defaults, 8, 1, "default");
await shot("default");
for (let i of [1, 5, 15, 16, 21]) {
  await inspect(i);
  await verify(defaults, i, 1, "quote" + i);
}
for (let e of [0.25, 2]) {
  await expiry(e);
  await verify(defaults, 21, e, "expiry" + e);
}
for (let c of [
  { surface: 1, noise: 100, seed: 9999 },
  { surface: 2, noise: 0, seed: 1 },
]) {
  await apply(c);
  await inspect(16);
  await expiry(0.25);
  await verify(c, 16, 0.25, "scenario" + c.surface);
  await shot("scenario" + c.surface);
}
// Edits and duplicate submits during a worker run must not change its captured config.
for (const [k, v] of Object.entries({ surface: 1, noise: 20, seed: 42 }))
  await input(k, v);
await event("controls", "submit");
check(
  "worker pending disables run",
  await evaluate(`document.getElementById('run').disabled`),
);
await input("noise", 50);
await event("noise", "input");
await event("controls", "submit");
await waitFor(
  async () => await evaluate(`!document.getElementById('run').disabled`),
  "pending captured config",
);
check(
  "pending edit stays dirty",
  await evaluate(
    `document.getElementById('status').textContent.includes('relative noise 20 bps')&&document.getElementById('status').textContent.includes('EDITING')`,
  ),
);
await inspect(8);
await expiry(1);
await verify(
  { surface: 1, noise: 20, seed: 42 },
  8,
  1,
  "pending captured result",
);
await apply(defaults);
await inspect(8);
await expiry(1);
const previous = await evaluate(
  `document.getElementById('ledger').textContent`,
);
await input("noise", -1);
await event("controls", "submit");
check(
  "invalid retention",
  await evaluate(
    `document.getElementById('status').textContent.startsWith('Not applied')`,
  ),
);
check(
  "invalid data unchanged",
  (await evaluate(`document.getElementById('ledger').textContent`)) ===
    previous,
);
await input("noise", 30);
await event("noise", "input");
check(
  "dirty notice",
  await evaluate(
    `document.getElementById('status').textContent.includes('EDITING')`,
  ),
);
await input("quote", "");
await event("quote", "change");
check(
  "invalid inspector retains selection",
  await evaluate(
    `document.querySelector('#ledger tr.selected').cells[0].textContent==='8'&&document.getElementById('selection').textContent.includes('Invalid')`,
  ),
);
await inspect(8);
for (let width of [1440, 768, 390, 360, 320]) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    async () =>
      await evaluate(
        `document.getElementById('prices').getAttribute('viewBox').split(' ')[2]===String(document.getElementById('prices').clientWidth)`,
      ),
    "resize",
  );
  await verify(defaults, 8, 1, "width" + width);
  let bounds = await evaluate(
    `(()=>{let b=e=>{let r=e.getBoundingClientRect();return[r.left,r.right,r.height]};return{page:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('input,select,button')].map(b),core:[...document.querySelectorAll('.metrics,.parameter,dt,dd,#prices,#lossplot,.intro')].map(b),gaps:[...document.querySelectorAll('dl>div')].every(e=>e.querySelector('dd').getBoundingClientRect().left-e.querySelector('dt').getBoundingClientRect().right>=15)}})()`,
  );
  check(width + " page", bounds.page <= width);
  check(
    width + " controls44",
    bounds.controls.every(
      (a) => a[0] >= 17 && a[1] <= width - 17 && a[2] >= 44,
    ),
  );
  check(
    width + " core",
    bounds.core.every((a) => a[0] >= 17 && a[1] <= width - 17),
  );
  check(width + " audit gaps", bounds.gaps);
  check(
    width + " headline at most3lines",
    await evaluate(
      `(()=>{let e=document.querySelector('h1');return e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight)<=3.01})()`,
    ),
  );
  check(
    width + " chart text within native SVG",
    await evaluate(
      `['prices','lossplot'].every(id=>{let e=document.getElementById(id),w=e.viewBox.baseVal.width,h=e.viewBox.baseVal.height;return [...e.querySelectorAll('text')].every(t=>{let b=t.getBBox();return b.x>=-0.1&&b.x+b.width<=w+.1&&b.y>=-.1&&b.y+b.height<=h+.1})})`,
    ),
  );
  await shot("width" + width);
}
await evaluate(
  `{let e=document.querySelector('.table-scroll');e.scrollLeft=e.scrollWidth;e.scrollTop=e.scrollHeight;true}`,
);
check(
  "two axis supplemental scroll",
  await evaluate(
    `(()=>{let e=document.querySelector('.table-scroll');return e.scrollLeft>0&&e.scrollTop>0&&Math.abs(e.scrollTop+e.clientHeight-e.scrollHeight)<2})()`,
  ),
);
await shot("ledger-right320");
await evaluate(`document.activeElement?.blur();document.body.focus();true`);
await cdp("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "Tab",
  code: "Tab",
  windowsVirtualKeyCode: 9,
});
await cdp("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "Tab",
  code: "Tab",
  windowsVirtualKeyCode: 9,
});
check(
  "real Tab traversal",
  await evaluate(
    `document.activeElement.matches('a,input,select,button')&&document.activeElement.matches(':focus-visible')`,
  ),
);
check(
  "keyboard focus",
  await evaluate(
    `(()=>{document.querySelector('button').focus();return getComputedStyle(document.activeElement).outlineStyle!=='none'})()`,
  ),
);
await cdp("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
check(
  "reduced motion",
  await evaluate(
    `getComputedStyle(document.documentElement).scrollBehavior==='auto'`,
  ),
);
await cdp("Emulation.setEmulatedMedia", { features: [] });
await cdp("Network.emulateNetworkConditions", {
  offline: false,
  latency: 250,
  downloadThroughput: 50000,
  uploadThroughput: 50000,
});
await cdp("Page.reload", { ignoreCache: true });
await waitFor(
  async () =>
    await evaluate(
      `document.querySelectorAll('#ledger tr').length===21&&!document.getElementById('run').disabled`,
    ),
  "throttled fit",
);
await verify(defaults, 8, 1, "throttled");
await shot("throttled320");
check(
  "origin only requests",
  requests
    .filter((u) => !u.startsWith("about:"))
    .every(
      (u) => u.startsWith(new URL(url).origin + "/") || u.startsWith("data:"),
    ),
);
check("no exceptions", consoleErrors.length === 0, consoleErrors.join(";"));
check(
  "no storage",
  await evaluate(
    `localStorage.length===0&&sessionStorage.length===0&&document.cookie===''`,
  ),
);
check(
  "CSP worker and no connection",
  await evaluate(
    `(()=>{let c=document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;return c.includes("connect-src 'none'")&&c.includes("worker-src 'self'")})()`,
  ),
);
check(
  "no inline style",
  await evaluate(`document.querySelectorAll('[style]').length===0`),
);
writeFileSync(`${root}browser-checks.json`, JSON.stringify(checks, null, 2));
console.log(
  `${checks.length} Chrome checks, ${checks.filter((c) => !c.ok).length} failures`,
);
clearTimeout(timeout);
ws.close();
await cleanup(checks.some((c) => !c.ok) ? 1 : 0);
