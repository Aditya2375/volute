import { run } from "./model.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: run(data.config) });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
