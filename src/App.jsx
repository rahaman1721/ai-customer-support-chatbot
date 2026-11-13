import React, { useEffect, useRef, useState } from "react";

const STORE = "support-chat-v1";

// Small, safe renderer: paragraphs, bullet/numbered lists, **bold**, `code`. No raw HTML is ever injected.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function Rich({ text }) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l)))
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}</ul>;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
      return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}</ol>;
    return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
  });
}

export default function App() {
  const [config, setConfig] = useState({ company: "Support", supportEmail: "", suggestions: [] });
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {}); }, []);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(messages)); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    setError("");
    setInput("");
    const next = [...messages, { role: "user", content }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Something went wrong.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMessages([...next, { role: "assistant", content: acc }]);
            }
          } catch {}
        }
      }
      if (!acc) throw new Error("No reply came back. Try sending that again.");
    } catch (e) {
      if (e.name !== "AbortError") {
        setError(e.message);
        setMessages((m) => (m.at(-1)?.role === "assistant" && !m.at(-1).content ? m.slice(0, -1) : m));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="app">
      <header className="top">
        <span className="brand">{config.company}</span>
        <div className="top-actions">
          {!empty && (
            <button className="link" onClick={() => { abortRef.current?.abort(); setMessages([]); setError(""); }}>
              New conversation
            </button>
          )}
          {config.supportEmail && <a className="link" href={`mailto:${config.supportEmail}`}>Talk to a person</a>}
        </div>
      </header>

      <main className="stream" aria-live="polite">
        {empty ? (
          <section className="intro">
            <h1>What can we help with?</h1>
            <p className="sub">Ask about orders, returns, delivery or your account.</p>
            <ul className="starters">
              {config.suggestions.map((s) => (
                <li key={s}><button onClick={() => send(s)}>{s}</button></li>
              ))}
            </ul>
          </section>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div className="msg user" key={i}><div>{m.content}</div></div>
            ) : (
              <div className="msg bot" key={i}>
                <Rich text={m.content} />
                {busy && i === messages.length - 1 && <span className="caret" aria-label="Typing" />}
              </div>
            )
          )
        )}
        {error && <p className="error" role="alert">{error} <button className="link" onClick={() => setError("")}>Dismiss</button></p>}
        <div ref={endRef} />
      </main>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          placeholder="Type your question"
          aria-label="Your question"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        {busy ? (
          <button type="button" className="send stop" onClick={() => abortRef.current?.abort()}>Stop</button>
        ) : (
          <button type="submit" className="send" disabled={!input.trim()}>Send</button>
        )}
      </form>
    </div>
  );
}
