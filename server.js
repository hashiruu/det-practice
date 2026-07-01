#!/usr/bin/env node
// DET practice server — static files + DeepSeek proxy.
// The API key is read from the ArxivPush backend .env on every request,
// so key rotation there is picked up automatically and never reaches the client.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = 8090;
const ENV_PATH = process.env.DEEPSEEK_ENV_PATH || "/data/arxivpush/backend/.env";

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/ai") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { system, user, max_tokens } = JSON.parse(body);
        const env = loadEnv();
        if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not found");
        // deepseek-v4-pro is a reasoning model: thinking tokens count toward
        // max_tokens. If the budget runs out mid-thought, content comes back
        // empty — NEVER fall back to reasoning_content (that leaks the chain
        // of thought to the UI); double the budget and retry instead.
        let mt = Math.min(Math.max(max_tokens || 1500, 1200), 4000);
        let content = "";
        for (let attempt = 0; attempt < 3 && !content; attempt++) {
          const sys = String(system || "") + (attempt > 0 ? "\n（重要：尽量减少思考，直接输出最终答案正文。）" : "");
          const ac = new AbortController(); // 单次尝试 75s 超时：宁可快速失败重试，不能让前端无限等
          const tt = setTimeout(() => ac.abort(), 75000);
          const r = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
            method: "POST", signal: ac.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
              model: env.DEEPSEEK_MODEL || "deepseek-chat",
              messages: [
                { role: "system", content: sys },
                { role: "user", content: String(user || "") },
              ],
              temperature: 0.6,
              max_tokens: mt,
            }),
          });
          const j = await r.json().finally(() => clearTimeout(tt));
          if (!r.ok) { if (attempt < 2) continue; throw new Error(j.error?.message || `upstream ${r.status}`); }
          content = (j.choices[0].message.content || "").trim();
          mt = Math.min(mt * 2, 8000);
        }
        if (!content) throw new Error("模型思考超长没产出正文，请重试或减少一次讲解的词数");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ content }));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }

  // cross-browser progress sync: one profile (single-user, tailnet-only site)
  if (req.url === "/api/state" && req.method === "GET") {
    fs.readFile(path.join(ROOT, "data", "profile.json"), "utf8", (err, data) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(err ? JSON.stringify({ state: null }) : data);
    });
    return;
  }
  if (req.url === "/api/state" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 5_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const j = JSON.parse(body);
        if (!j || typeof j.state !== "object") throw new Error("bad payload");
        const dir = path.join(ROOT, "data");
        fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, "profile.json.tmp");
        fs.writeFileSync(tmp, JSON.stringify({ state: j.state, ts: Date.now() }));
        fs.renameSync(tmp, path.join(dir, "profile.json"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/transcribe") {
    const chunks = [];
    let size = 0;
    req.on("data", c => { size += c.length; if (size > 30_000_000) req.destroy(); else chunks.push(c); });
    req.on("end", async () => {
      try {
        const buf = Buffer.concat(chunks);
        if (buf.length < 800) { // an empty/instant recording produces a header-only blob
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没录到声音，请重新录音" }));
          return;
        }
        const r = await fetch("http://127.0.0.1:8095/transcribe", { method: "POST", body: buf });
        const text = await r.text();
        let j;
        try { j = JSON.parse(text); }
        catch { j = { error: `转写服务响应异常（${r.status}）` }; }
        res.writeHead(r.ok ? 200 : 502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(j));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "转写服务不可用: " + String(e.message || e) }));
      }
    });
    return;
  }

  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      // always revalidate so deployed fixes reach browsers immediately
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`det-practice listening on :${PORT}`));
