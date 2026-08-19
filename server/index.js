import { loadEnv } from "./env.js";
loadEnv();

import http from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { callGemini, callGeminiJSON, isConfigured } from "./gemini.js";
import { assessCrisis } from "./crisisDetection.js";
import { buildCrisisMessage, CRISIS_RESOURCES } from "./crisisResources.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import {
  addMessage,
  getRecentMessages,
  addMood,
  getMoodHistory,
  getMoodSummary,
  getUserSnapshot,
  bumpConnectionNudgeCounter,
  resetConnectionNudgeCounter,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Single local user for this demo. A multi-user deployment would derive this
// from an authenticated session instead. See README.
const USER_ID = "default";

// How many user messages before we allow one gentle real-world-connection nudge.
const CONNECTION_NUDGE_EVERY = 8;

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html" },
  "/index.html": { file: "index.html", type: "text/html" },
  "/styles.css": { file: "styles.css", type: "text/css" },
  "/main.js": { file: "main.js", type: "application/javascript" },
};

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJSONBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function serveStatic(res, pathname) {
  const entry = STATIC_FILES[pathname];
  if (!entry) return false;
  try {
    const data = await readFile(path.join(PUBLIC_DIR, entry.file));
    res.writeHead(200, { "Content-Type": entry.type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
  return true;
}

async function handleHistory(_req, res) {
  const snapshot = await getUserSnapshot(USER_ID);
  const moodSummary = await getMoodSummary(USER_ID);
  sendJSON(res, 200, { ...snapshot, moodSummary, geminiConfigured: isConfigured() });
}

async function handleGetMood(_req, res) {
  sendJSON(res, 200, { moods: await getMoodHistory(USER_ID), summary: await getMoodSummary(USER_ID) });
}

async function handlePostMood(req, res) {
  const body = await readJSONBody(req);
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return sendJSON(res, 400, { error: "score must be an integer 1-5" });
  }
  const entry = await addMood(USER_ID, score, String(body.note || "").slice(0, 500));
  const moodSummary = await getMoodSummary(USER_ID);
  sendJSON(res, 200, { entry, moodSummary });
}

async function handleChat(req, res) {
  const body = await readJSONBody(req);
  const message = body.message;
  if (typeof message !== "string" || !message.trim()) {
    return sendJSON(res, 400, { error: "message is required" });
  }
  const text = message.slice(0, 4000);
  await addMessage(USER_ID, "user", text);

  try {
    const crisis = await assessCrisis(text, {
      callGeminiJSON: isConfigured() ? callGeminiJSON : null,
      threshold: Number(process.env.CRISIS_LLM_THRESHOLD || 0.5),
    });

    if (crisis.isCrisis) {
      const reply = buildCrisisMessage();
      await addMessage(USER_ID, "assistant", reply, { crisis: true, crisisSource: crisis.source });
      await resetConnectionNudgeCounter(USER_ID);
      return sendJSON(res, 200, { reply, crisis: true, resources: CRISIS_RESOURCES });
    }

    if (!isConfigured()) {
      // Not persisted: this is a config notice, not part of the conversation, so it
      // shouldn't clutter permanent history once a real key is added later.
      const reply =
        "(The conversational AI isn't configured yet — GEMINI_API_KEY is missing from .env. " +
        "Your message was still saved. Mood check-ins and crisis-safety detection work " +
        "without it.)";
      return sendJSON(res, 200, { reply, crisis: false, notConfigured: true });
    }

    const nudgeCount = await bumpConnectionNudgeCounter(USER_ID);
    const suggestConnection = nudgeCount >= CONNECTION_NUDGE_EVERY;
    if (suggestConnection) await resetConnectionNudgeCounter(USER_ID);

    const moodSummary = await getMoodSummary(USER_ID);
    const systemInstruction = buildSystemPrompt({ moodSummary, suggestConnection });
    const history = await getRecentMessages(USER_ID, 20);
    const reply = await callGemini(
      history.map((m) => ({ role: m.role, content: m.content })),
      systemInstruction
    );

    await addMessage(USER_ID, "assistant", reply);
    sendJSON(res, 200, { reply, crisis: false });
  } catch (err) {
    console.error("chat error:", err);
    const rateLimited = err.message.includes("Gemini API error 429");
    const errorMessage = rateLimited
      ? "I'm getting rate-limited by the AI provider right now — please try again in a minute. " +
        "(Your message was saved.)"
      : "Something went wrong generating a reply. Please try again. (Your message was saved.)";
    sendJSON(res, rateLimited ? 429 : 500, { error: errorMessage });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");

  try {
    if (req.method === "GET" && pathname === "/api/history") return await handleHistory(req, res);
    if (req.method === "GET" && pathname === "/api/mood") return await handleGetMood(req, res);
    if (req.method === "POST" && pathname === "/api/mood") return await handlePostMood(req, res);
    if (req.method === "POST" && pathname === "/api/chat") return await handleChat(req, res);
    if (req.method === "GET" && (await serveStatic(res, pathname))) return;

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    if (err.message === "Invalid JSON body" || err.message === "Request body too large") {
      return sendJSON(res, 400, { error: err.message });
    }
    console.error("request error:", err);
    sendJSON(res, 500, { error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Loneliness Support Companion listening on http://localhost:${PORT}`);
  if (!isConfigured()) {
    console.warn("GEMINI_API_KEY not set — chat replies will be disabled until you add one to .env");
  }
});
