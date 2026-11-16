import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("docs/src", { recursive: true });
for (let p of [
  "index.html",
  "styles.css",
  "src/app.js",
  "src/model.js",
  "src/worker.js",
])
  copyFileSync("web/" + p, "docs/" + p);
