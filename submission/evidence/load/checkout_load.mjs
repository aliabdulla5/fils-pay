// Checkout load driver: each virtual user opens a payment link and pays it
// (GET /v1/payment-links/:token, then POST /v1/payment-links/:token/pay),
// looping until the stage ends. Usage:
//   node checkout_load.mjs <baseUrl> <tokensFile> <stages "vus:seconds,...">
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [base, tokensFile, stagesArg, outFile] = process.argv.slice(2);
const tokens = readFileSync(tokensFile, "utf8").trim().split("\n");
let next = 0;
const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function checkout() {
  const token = tokens[next++];
  if (!token) return { code: "no_tokens", ms: 0 };
  const t0 = performance.now();
  try {
    const view = await fetch(`${base}/v1/payment-links/${token}`, { signal: AbortSignal.timeout(15000) });
    await view.arrayBuffer();
    if (view.status !== 200) return { code: `view_${view.status}`, ms: performance.now() - t0, token };
    const pay = await fetch(`${base}/v1/payment-links/${token}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ card }),
      signal: AbortSignal.timeout(15000),
    });
    await pay.arrayBuffer();
    return { code: String(pay.status), ms: performance.now() - t0, token };
  } catch (err) {
    return { code: err.name === "TimeoutError" ? "timeout" : "conn_error", ms: performance.now() - t0 };
  }
}

async function stage(vus, seconds) {
  const end = Date.now() + seconds * 1000;
  const lat = [];
  const codes = {};
  const user = async () => {
    while (Date.now() < end) {
      const r = await checkout();
      // A refused request (503) never reached the link: hand it back.
      if (r.code === "503" || r.code === "view_503") tokens.push(r.token);
      codes[r.code] = (codes[r.code] ?? 0) + 1;
      if (r.code === "200") lat.push(r.ms);
      if (r.code === "no_tokens") return;
    }
  };
  await Promise.all(Array.from({ length: vus }, user));
  lat.sort((a, b) => a - b);
  const ok = codes["200"] ?? 0;
  const total = Object.values(codes).reduce((a, b) => a + b, 0);
  return {
    vus,
    seconds,
    attempts: total,
    paid: ok,
    paidPerSec: +(ok / seconds).toFixed(1),
    p50ms: Math.round(pct(lat, 50)),
    p95ms: Math.round(pct(lat, 95)),
    p99ms: Math.round(pct(lat, 99)),
    codes,
  };
}

const results = [];
for (const s of stagesArg.split(",")) {
  const [vus, secs] = s.split(":").map(Number);
  const r = await stage(vus, secs);
  results.push(r);
  console.log(JSON.stringify(r));
}
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
