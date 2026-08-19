import test from "node:test";
import assert from "node:assert/strict";
import { keywordCrisisCheck, assessCrisis } from "../server/crisisDetection.js";

test("keyword layer catches direct suicidal statements", () => {
  const cases = [
    "I want to kill myself",
    "I've been thinking about suicide a lot",
    "I just want to end my life",
    "sometimes I wish I were dead",
    "I don't want to wake up tomorrow",
    "I've been cutting myself",
    "there's no reason to go on anymore",
  ];
  for (const text of cases) {
    assert.equal(keywordCrisisCheck(text).matched, true, `expected match: "${text}"`);
  }
});

test("keyword layer does not flag ordinary sadness or idioms", () => {
  const cases = [
    "I'm feeling really lonely today",
    "work has been killing me this week",
    "I could just die of embarrassment",
    "I'm sad and don't know why",
    "today was a rough day",
  ];
  for (const text of cases) {
    assert.equal(keywordCrisisCheck(text).matched, false, `expected no match: "${text}"`);
  }
});

test("assessCrisis works keyword-only when no LLM classifier is provided", async () => {
  const result = await assessCrisis("I want to kill myself", { callGeminiJSON: null, threshold: 0.5 });
  assert.equal(result.isCrisis, true);
  assert.equal(result.source, "keyword");
});

test("assessCrisis is not fooled into crisis mode by benign text with no LLM configured", async () => {
  const result = await assessCrisis("I'm just a bit lonely tonight", { callGeminiJSON: null, threshold: 0.5 });
  assert.equal(result.isCrisis, false);
});

test("assessCrisis combines LLM signal when keyword layer misses indirect phrasing", async () => {
  const fakeLLM = async () => ({ crisis: true, confidence: 0.9, reason: "indirect ideation" });
  const result = await assessCrisis("I don't think I'll be around much longer", {
    callGeminiJSON: fakeLLM,
    threshold: 0.5,
  });
  assert.equal(result.isCrisis, true);
  assert.equal(result.source, "llm");
});

test("assessCrisis fails open (keyword-only) if the LLM classifier throws", async () => {
  const throwing = async () => {
    throw new Error("network down");
  };
  const result = await assessCrisis("I'm having a hard week", { callGeminiJSON: throwing, threshold: 0.5 });
  assert.equal(result.isCrisis, false);
  assert.equal(result.llm.skipped, true);
});
