// Thin wrapper around the Gemini REST API (generativelanguage.googleapis.com).
// Uses global fetch (Node 18+), no SDK dependency needed for a project this size.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  return { apiKey, model };
}

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function generateContent({ systemInstruction, contents, generationConfig }) {
  const { apiKey, model } = getConfig();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to your .env file.");
  }

  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents,
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    // 2048 is a generous ceiling, not a target — replies are kept short by the system
    // prompt. Note: "thinking" models (e.g. gemini-3.6-flash) spend several hundred
    // tokens on hidden reasoning before any visible text, so a low cap can truncate
    // the reply to nothing; gemini-3.5-flash-lite (the default) has no such overhead.
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048, ...generationConfig },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  return text.trim();
}

// messages: [{ role: 'user'|'assistant', content }]
export async function callGemini(messages, systemInstruction) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  return generateContent({ systemInstruction, contents });
}

// Used only by the crisis classifier: single-turn, low temperature, JSON-only.
export async function callGeminiJSON(prompt) {
  const text = await generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: "application/json" },
  });
  return JSON.parse(text);
}
