# Walkthrough

Written walkthrough (in lieu of video) demonstrating the three required
scenarios, **all three captured live against the actual running app** with a
real Gemini key — not hand-written. Screenshots are in `screenshots/`.
Timestamps/order were produced by the reproduction commands at the bottom;
nothing here is edited beyond trimming which curl commands to show.

## 1. A normal supportive conversation

```
User: honestly not sure why im telling you this but ive just felt kind of
invisible lately

Companion: It takes a lot to share that, and I'm really glad you did.
Feeling like people aren't seeing you or noticing your presence can be such
a heavy, isolating thing to carry around.

If it feels okay, what are some of the moments recently where that feeling
hit you the hardest?
```

Screenshot: `screenshots/normal-conversation.png`. What I'd flag here: the
companion reflects the *specific* thing said back ("invisible," "not being
seen") instead of a generic "that sounds hard," asks one open question, and
doesn't claim to understand more than it actually does.

## 2. Mood check-in referencing a pattern

Seven mood check-ins were logged at a higher average (3, 3, 4, 3, 3, 3, 3),
then seven more at a lower average (2, 1, 2, 2, 1, 2, 2) — simulating two
weeks where the second was rougher than the first. The app's own trend
computation (`server/store.js: getMoodSummary`, plain arithmetic, no LLM
involved) correctly labeled it:

```
Recent average 1.7/5 over 7 check-ins — lower than the previous week.
```

That summary was injected into the system prompt for the next message:

```
User: hey, not sure what to say today, just checking in

Companion: Thanks for checking in anyway, especially on a day when the words
aren't really there. It sounds like things have been pretty heavy overall
this week.

If you feel like sharing what's on your mind — or even just sitting with
the quiet — I'm here.
```

Screenshot: `screenshots/mood-pattern.png` (the sparkline on the mood card
visibly dips too). The thing worth noticing is that it's a soft, natural nod
to "this week" — not a readout of the number 1.7, not a label — which is
exactly what the system prompt asks for: reference the pattern supportively,
never clinically, and not on every single message.

## 3. Simulated crisis-language input

```
User: Honestly I have been thinking about ending my life

Companion: I'm really glad you told me this. I want to be honest with you:
I'm an AI, and when things feel this heavy or dangerous, I'm not the right
one to handle it alone — you deserve support from people who are trained for
this and can actually help.

Here's how to reach someone right now:
• 988 Suicide & Crisis Lifeline (US) — Call or text 988 — free, 24/7
• Crisis Text Line — Text HOME to 741741
• Outside the US — findahelpline.com lists local crisis lines by country
• Immediate danger — Contact your local emergency number (e.g. 911 in the US)
  right now

You don't have to carry this by yourself. Is there someone nearby — a friend,
family member, or doctor — you could reach out to right now?
```

This exact transcript was captured live against the running app (see
`screenshots/crisis.png`) — the response is the fixed template from
`crisisResources.js`, not an LLM completion; the keyword layer
(`end(ing)? my( own)? life`) caught it deterministically. It renders in the UI
with distinct red-bordered styling so it's visually unmistakable from a
normal reply. One follow-up question only, no interrogation, no attempt by
the AI to talk the user out of it or counsel them itself.

## Reproducing these yourself

```bash
npm start
# then, in another terminal:

# Scenario 1 — normal conversation
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"message":"honestly not sure why im telling you this but ive just felt kind of invisible lately"}'

# Scenario 2 — mood pattern (log a rougher week, then check in)
for s in 3 3 4 3 3 3 3; do curl -s -X POST http://localhost:3000/api/mood \
  -H "Content-Type: application/json" -d "{\"score\":$s}" > /dev/null; done
for s in 2 1 2 2 1 2 2; do curl -s -X POST http://localhost:3000/api/mood \
  -H "Content-Type: application/json" -d "{\"score\":$s}" > /dev/null; done
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"message":"hey, not sure what to say today, just checking in"}'

# Scenario 3 — crisis language
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"message":"Honestly I have been thinking about ending my life"}'
```

Scenario 3 (crisis) works even without a `GEMINI_API_KEY` configured, since
the keyword layer requires no LLM call — mood tracking also needs no key.
Scenarios 1 and 2's conversational replies need a real key in `.env`. Model
replies are non-deterministic, so re-running will produce similar but not
identical wording each time — that's expected.
