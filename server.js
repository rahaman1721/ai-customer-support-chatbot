// Proxy + static server. The Groq key stays here and never reaches the browser.
// Run: npm run build && node server.js   (Node 18+)
const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = process.env.GROQ_URL || "https://api.groq.com/openai/v1/chat/completions";
const DIST = path.join(__dirname, "dist");

if (!KEY) {
  console.error("Missing GROQ_API_KEY. Add it to .env next to server.js.");
  process.exit(1);
}

const loadFaq = () => JSON.parse(fs.readFileSync(path.join(__dirname, "faq.json"), "utf8"));

function systemPrompt() {
  const { company, supportEmail, supportHours, faqs } = loadFaq();
  const kb = faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");
  return `You are the customer support assistant for ${company}.
Answer using only the support information below. Keep replies short and plain, in the customer's language.
If the answer isn't covered, say you don't have that information and point them to ${supportEmail} (${supportHours}). Never invent policies, prices, or timelines.
If the customer is upset, acknowledge it in one sentence before helping.

SUPPORT INFORMATION
${kb}`;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/config") {
    const { company, supportEmail, supportHours, faqs } = loadFaq();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ company, supportEmail, supportHours, suggestions: faqs.slice(0, 4).map((f) => f.q) }));
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1_000_000) return res.writeHead(413).end();
    }
    let data;
    try { data = JSON.parse(body); } catch { return res.writeHead(400).end("Bad JSON"); }

    // Only user/assistant turns come from the browser; the system prompt is ours.
    const history = (Array.isArray(data.messages) ? data.messages : [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-20);

    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());

    try {
      const upstream = await fetch(GROQ_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          temperature: 0.3,
          messages: [{ role: "system", content: systemPrompt() }, ...history],
        }),
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        let msg = text;
        try { msg = JSON.parse(text).error?.message || text; } catch {}
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: msg }));
      }

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      for await (const chunk of upstream.body) res.write(chunk);
      res.end();
    } catch (err) {
      if (err.name === "AbortError") return;
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Couldn't reach the AI service. Try again in a moment." }));
    }
    return;
  }

  // Static files from the Vite build
  if (req.method === "GET") {
    const clean = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(DIST, clean === "/" ? "index.html" : clean);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(500).end("Run `npm run build` first.");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    return res.end(fs.readFileSync(file));
  }

  res.writeHead(404).end("Not found");
});

server.listen(PORT, () => console.log(`Support chat running at http://localhost:${PORT}`));
