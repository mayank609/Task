// Real React, loaded as ES modules straight from esm.sh — no bundler, no
// npm install step. `htm` gives JSX-like template syntax without a compiler.
// (See README for why this project has no build step.)
import React, { useState, useEffect, useRef, useCallback } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

const MOOD_LABELS = { 1: "Really rough", 2: "Not great", 3: "Okay", 4: "Good", 5: "Really good" };
const MOOD_EMOJI = { 1: "😞", 2: "🙁", 3: "😐", 4: "🙂", 5: "😄" };

function Sparkline({ moods }) {
  if (!moods || moods.length < 2) return null;
  const points = moods.slice(-14);
  const w = 240;
  const h = 40;
  const stepX = w / Math.max(points.length - 1, 1);
  const coords = points.map((m, i) => {
    const x = i * stepX;
    const y = h - ((m.score - 1) / 4) * h;
    return [x, y];
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return html`
    <svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d=${path} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx=${last[0]} cy=${last[1]} r="3" fill="currentColor" />
    </svg>
  `;
}

function MoodPanel({ moods, moodSummary, onLogMood }) {
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!selected) {
      setStatus("Pick a number first.");
      return;
    }
    setBusy(true);
    setStatus("Saving…");
    await onLogMood(selected, note);
    setStatus("Logged. Thanks for sharing.");
    setNote("");
    setBusy(false);
  }, [selected, note, onLogMood]);

  return html`
    <section class="card mood-panel" aria-label="Daily mood check-in">
      <div class="mood-header">
        <h2>How are you feeling today?</h2>
        ${moodSummary && html`<${Sparkline} moods=${moods} />`}
      </div>
      <div class="mood-scale" role="group" aria-label="Mood scale 1 to 5">
        ${[1, 2, 3, 4, 5].map(
          (n) => html`
            <button
              key=${n}
              class=${"mood-btn" + (selected === n ? " selected" : "")}
              title=${MOOD_LABELS[n]}
              onClick=${() => setSelected(n)}
            >
              <span class="mood-emoji">${MOOD_EMOJI[n]}</span>
              <span class="mood-num">${n}</span>
            </button>
          `
        )}
      </div>
      <input
        class="mood-note"
        type="text"
        maxlength="200"
        placeholder="Optional note — what's making it that?"
        value=${note}
        onInput=${(e) => setNote(e.target.value)}
      />
      <div class="mood-footer">
        <button class="btn-primary" onClick=${submit} disabled=${busy}>Log today's mood</button>
        <span class="mood-status">${status}</span>
      </div>
      <p class="mood-summary-text">
        ${moodSummary
          ? html`Recent average <strong>${moodSummary.recentAverage}/5</strong> over ${moodSummary.entryCount} check-ins — ${moodSummary.trend}.`
          : "No check-ins yet. Logging daily helps the companion notice patterns supportively, over time."}
      </p>
    </section>
  `;
}

function MessageBubble({ msg }) {
  const cls = msg.crisis ? "bubble crisis" : `bubble ${msg.role}`;
  return html`<div class=${cls}>${msg.content}</div>`;
}

function TypingBubble() {
  return html`
    <div class="bubble assistant typing" aria-label="Companion is typing">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
}

function ChatPanel({ messages, geminiConfigured, onSend }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || sending) return;
      setInput("");
      setSending(true);
      await onSend(text);
      setSending(false);
    },
    [input, sending, onSend]
  );

  return html`
    <section class="card chat-panel" aria-label="Conversation">
      <div class="messages" ref=${scrollRef}>
        ${!geminiConfigured &&
        html`<div class="bubble notice">
          Heads up — GEMINI_API_KEY isn't set on the server yet, so conversational replies are
          disabled until it is. Mood check-ins and crisis-safety detection still work.
        </div>`}
        ${messages.map((m, i) => html`<${MessageBubble} key=${i} msg=${m} />`)}
        ${sending && html`<${TypingBubble} />`}
      </div>
      <form class="chat-form" onSubmit=${submit}>
        <textarea
          rows="2"
          placeholder="What's on your mind?"
          value=${input}
          onInput=${(e) => setInput(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
        ></textarea>
        <button type="submit" class="btn-primary" disabled=${sending || !input.trim()}>Send</button>
      </form>
      <p class="disclaimer">
        This is an AI support companion — not a therapist, not a replacement for real
        relationships or professional care. If you're in immediate danger, contact local
        emergency services.
      </p>
    </section>
  `;
}

function App() {
  const [messages, setMessages] = useState([]);
  const [moods, setMoods] = useState([]);
  const [moodSummary, setMoodSummary] = useState(null);
  const [geminiConfigured, setGeminiConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || []);
        setMoods(data.moods || []);
        setMoodSummary(data.moodSummary || null);
        setGeminiConfigured(Boolean(data.geminiConfigured));
        setLoaded(true);
      });
  }, []);

  const logMood = useCallback(async (score, note) => {
    const res = await fetch("/api/mood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, note }),
    });
    const data = await res.json();
    setMoodSummary(data.moodSummary);
    setMoods((prev) => [...prev, data.entry]);
  }, []);

  const sendMessage = useCallback(async (text) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.error || "Something went wrong." }]);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, crisis: data.crisis }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Network error — please try again." }]);
    }
  }, []);

  return html`
    <div class="app">
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">◐</span>
          <h1>Companion</h1>
        </div>
        <p class="tagline">A space to talk things through. Not therapy, not roleplay — just listening.</p>
      </header>
      ${loaded &&
      html`
        <${MoodPanel} moods=${moods} moodSummary=${moodSummary} onLogMood=${logMood} />
        <${ChatPanel} messages=${messages} geminiConfigured=${geminiConfigured} onSend=${sendMessage} />
      `}
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
