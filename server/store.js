// Minimal file-backed persistence for a single-user local demo.
// A real deployment would swap this for a proper DB + auth; see README "what I'd
// do differently". Writes are serialized through `queue` so concurrent requests
// can't corrupt the JSON file.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

function emptyUser() {
  return {
    messages: [], // { role: 'user'|'assistant', content, timestamp, crisis? }
    moods: [], // { score: 1-5, note, timestamp }
    messagesSinceConnectionNudge: 0,
  };
}

let cache = null;
let queue = Promise.resolve();

async function load() {
  if (cache) return cache;
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    cache = JSON.parse(raw);
  } catch {
    cache = { users: {} };
  }
  return cache;
}

async function persist() {
  await writeFile(STORE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

// Serializes all mutations so overlapping requests don't race on the same file.
function withWriteLock(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

async function getUser(userId) {
  const store = await load();
  if (!store.users[userId]) store.users[userId] = emptyUser();
  return store.users[userId];
}

export async function addMessage(userId, role, content, extra = {}) {
  return withWriteLock(async () => {
    const user = await getUser(userId);
    const entry = { role, content, timestamp: new Date().toISOString(), ...extra };
    user.messages.push(entry);
    await persist();
    return entry;
  });
}

export async function getRecentMessages(userId, limit = 20) {
  const user = await getUser(userId);
  return user.messages.slice(-limit);
}

export async function addMood(userId, score, note = "") {
  return withWriteLock(async () => {
    const user = await getUser(userId);
    const entry = { score, note, timestamp: new Date().toISOString() };
    user.moods.push(entry);
    await persist();
    return entry;
  });
}

export async function getMoodHistory(userId, limit = 30) {
  const user = await getUser(userId);
  return user.moods.slice(-limit);
}

// Cheap supportive summary: average + trend direction over the recent window.
// Deliberately NOT a clinical score — just enough for the AI to say
// "this week's felt heavier than last" without labeling anything.
export async function getMoodSummary(userId) {
  const history = await getMoodHistory(userId, 14);
  if (history.length === 0) return null;

  const recent = history.slice(-7);
  const prior = history.slice(-14, -7);
  const avg = (arr) => arr.reduce((s, m) => s + m.score, 0) / arr.length;

  const recentAvg = avg(recent);
  let trend = "not enough data yet";
  if (prior.length >= 2) {
    const priorAvg = avg(prior);
    const delta = recentAvg - priorAvg;
    if (delta <= -0.75) trend = "lower than the previous week";
    else if (delta >= 0.75) trend = "higher than the previous week";
    else trend = "fairly steady compared to the previous week";
  }

  return {
    recentAverage: Math.round(recentAvg * 10) / 10,
    entryCount: recent.length,
    trend,
    lastEntry: history[history.length - 1],
  };
}

export async function getUserSnapshot(userId) {
  const user = await getUser(userId);
  return { messages: user.messages, moods: user.moods };
}

export async function bumpConnectionNudgeCounter(userId) {
  return withWriteLock(async () => {
    const user = await getUser(userId);
    user.messagesSinceConnectionNudge = (user.messagesSinceConnectionNudge || 0) + 1;
    await persist();
    return user.messagesSinceConnectionNudge;
  });
}

export async function resetConnectionNudgeCounter(userId) {
  return withWriteLock(async () => {
    const user = await getUser(userId);
    user.messagesSinceConnectionNudge = 0;
    await persist();
  });
}
