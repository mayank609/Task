# Loneliness Support Companion

A small web app that offers warm, non-judgmental listening, daily mood
check-ins, and — most importantly — safe handling of crisis language. It's
explicitly **not** a therapist, **not** a diagnostic tool, and **not** a
roleplay/companion app.

Stack: **React** on the frontend, **Node** on the backend.

## 1. Setup

Requires Node 18+ (built-in `fetch`, nothing else). There's nothing to
`npm install` for the backend — it only uses Node's standard library plus
the Gemini REST API over `fetch`. The frontend is React, loaded as native ES
modules straight from a CDN (esm.sh), no bundler involved. More on why below.

```bash
cd loneliness-companion
cp .env.example .env
# edit .env and paste your Gemini key into GEMINI_API_KEY
npm start
# open http://localhost:3000
```

### Why no build step?

Not a shortcut to dodge setting up Vite — `public/main.js` is real React
(`useState`, `useEffect`, components, hooks), it just pulls `react`,
`react-dom`, and `htm` (JSX-like template literals, so no compiler needed)
straight from `esm.sh` via a native `<script type="module">`. The browser
resolves those imports at load time, same as any CDN script tag would.
Honestly, part of the reason is that npm's registry client was misbehaving
in the sandbox I built this in — raw network calls worked fine, `npm
install` itself just hung on sub-dependencies for reasons I never fully
tracked down. Rather than fight that, going dependency-free felt like the
more robust choice anyway: fewer moving parts, nothing that can fail to
install for the next person either.

If you'd rather have a conventional local toolchain (Vite + JSX +
`node_modules`), it's a pretty mechanical migration: move `main.js`'s
components into `.jsx` files, swap the `htm` tags for JSX, add
`react`/`react-dom`/`vite` to `package.json`, point the script tag at Vite's
dev server. The backend and API don't change either way.

Get a key at https://aistudio.google.com/apikey. Without one, the app still
runs — mood check-ins and crisis detection (the keyword layer) work with
zero external calls. Only the free-form conversational replies are
disabled, and it says so plainly rather than failing silently.

### A note on model choice

Default model is `gemini-3.5-flash-lite` (`server/gemini.js`, override with
`GEMINI_MODEL`). Got there the hard way, not by picking it first: my
original default, `gemini-2.0-flash`, turned out to be deprecated the
moment I actually tested against a real key. Its suggested replacement,
`gemini-3.6-flash`, is a "thinking" model — it spends several hundred
tokens on hidden reasoning before any visible reply comes out, and with a
low `maxOutputTokens` cap that meant replies were getting silently
truncated to nothing. `gemini-3.5-flash-lite` gives equally warm,
on-persona replies with no hidden-reasoning tax, answers faster, and pulls
from a separate free-tier quota than the flagship flash models. If you swap
in a thinking model yourself, keep `maxOutputTokens` generous (2048 is the
current default) or you'll get empty replies back.

Also worth flagging: the free tier caps `gemini-3.6-flash` at **20
requests/day per project**, which I burned through just testing this.
`gemini-3.5-flash-lite` has its own, much roomier bucket. If you see `429
RESOURCE_EXHAUSTED` in the logs, that's this quota, not a bug — the app
degrades gracefully either way (message still saved, user gets a friendly
retry note, crisis detection and mood tracking don't touch this quota at all).

Run the crisis-detection unit tests:

```bash
npm test
```

Chat history and mood logs live in `data/store.json`, a flat file, not a
database. This is a single-user local demo — see the "what I'd do
differently" section for what a real deployment would need instead.

## 2. Architecture

```
server/
  index.js            HTTP server (no framework) + routing
  env.js              tiny .env loader
  store.js            file-backed persistence (messages, moods)
  gemini.js           Gemini REST API client (chat + JSON classification)
  crisisDetection.js  keyword + LLM crisis classifier, combined
  crisisResources.js  fixed crisis resource list + fixed response template
  systemPrompt.js     persona/guardrail prompt sent to Gemini on safe turns
public/
  index.html           loads fonts + styles.css, mounts React into #root
  main.js              React app: MoodPanel, ChatPanel, Sparkline components
  styles.css            premium dark/light UI, no CSS framework
tests/                 unit tests for the crisis detector
```

One decision worth flagging up front: the crisis path never touches the
general-purpose LLM call. `assessCrisis()` runs before any "have a
supportive conversation" prompt gets built, and if it fires, the app
answers with a fixed template (`crisisResources.js`) instead of asking
Gemini to improvise something. More on why in the next section.

## 3. Crisis & Safety Handling

### Detection approach

Two layers, OR'd together — either one firing is enough to trigger the
safety path.

The first is a keyword/regex layer (`crisisDetection.js`,
`keywordCrisisCheck`) — a curated list of direct phrases ("kill myself",
"suicidal", "end my life", "want to die", "better off dead", "cutting
myself," and so on), checked with word-boundary regexes so it doesn't match
on bare "kill." It's deterministic and instant, and doesn't care whether the
LLM is up or well-behaved that day.

The second is an LLM classifier layer (`llmCrisisCheck`) — a separate,
single-turn call to Gemini instructed to act only as a safety classifier and
hand back `{crisis, confidence, reason}` as JSON. This exists because the
keyword list can't enumerate every indirect way someone might say this
("I don't think I'll be around much longer," "I've been saying goodbye to
people lately"). It only runs if a Gemini key is configured.

If either layer fires, you get a fixed template, not an LLM-generated
response: it names that this is an AI and not equipped to handle something
this serious alone, surfaces real resources (988, Crisis Text Line,
findahelpline.com for outside the US, and "call emergency services if
you're in immediate danger"), and asks one low-pressure question about
reaching a real person — not a multi-step script, and it doesn't keep
pushing after that.

### Why layer it this way

Keyword-only would miss indirect language. LLM-only means a bad classifier
call, a timeout, or a missing API key silently turns crisis detection off
entirely — not something I was willing to risk on the highest-weighted part
of this task. Stacking them means the dumb, deterministic layer acts as a
safety net under the smarter one.

The LLM classifier fails *open* on error — a network error falls back to
keyword-only for that message rather than inventing a crisis signal — but
the keyword layer always runs first, no matter what. If you'd rather the
system fail *closed* (treat classifier errors as crisis-positive and show
resources defensively), that's a one-line change in `llmCrisisCheck`'s
catch block. I went with fail-open because a crisis banner popping up on
every random network hiccup would end up eroding trust in the resources
themselves — but I'd want real usage data before being confident that's
the right call.

### Known trade-offs

False positives — flagging something that isn't actually a crisis — mostly
come from idioms and hyperbole ("this exam is killing me," "I could die of
embarrassment"). The keyword patterns are written narrowly on purpose (e.g.
`kill(ing)? myself`, not bare `kill`) to cut down on this, and the LLM
classifier prompt explicitly tells it not to flag idiomatic use. Some will
still slip through — there's a small idiom set covered in
`tests/crisisDetection.test.js`, though it's illustrative, not exhaustive.
Given how this task is weighted, I biased toward over-triggering rather
than under-triggering: a false positive costs an unnecessary but harmless
resource message, a false negative could cost a lot more.

False negatives are the scarier failure mode. Sarcasm, heavy misspelling,
non-English text, or very indirect phrasing can slip past both layers — the
keyword list is English-only, and the classifier, like any model, isn't
perfectly calibrated. If `GEMINI_API_KEY` isn't set, the app runs on
keyword-only detection, which is probably the single biggest known gap
here — it's surfaced explicitly rather than hidden (a warning on server
boot, `notConfigured: true` in the API response). There's also no
conversation-level memory feeding into crisis detection right now — each
message gets assessed on its own, so someone escalating gradually across
many messages, none individually alarming, wouldn't currently trip the
safety path. A production version should look at a short rolling window
instead of just the latest message.

None of this replaces a real, clinically-validated crisis classifier — a
moderation API purpose-built and evaluated for this specific job. See the
"what I'd do differently" section.

## 4. Healthy Engagement Design

No streaks, badges, "come back tomorrow" nudges, or push notifications —
nothing designed to maximize time-in-app. There isn't a notification system
in this codebase at all, and that's on purpose, not an oversight. The
system prompt (`systemPrompt.js`) explicitly tells the model never to
guilt-trip the user for leaving or going quiet, and never to manufacture
urgency.

Every 8 user messages in a row, the app allows — doesn't force — one
gentle nudge toward real-world connection (a friend, family, a
professional), woven into the system prompt for that one turn, then the
counter resets. Capping it at once per window was deliberate, so it can't
turn into a repeated, naggy script. The UI also carries a persistent
one-line disclaimer that this isn't a substitute for real relationships or
professional care.

## 5. Explicitly Out of Scope (and how it's enforced)

No romantic or sexual roleplay: the system prompt has a hard rule to
decline and redirect if asked, and there's no persona, character, or
roleplay framing anywhere in the app to begin with — it's deliberately just
"a listener," nothing else.

No diagnostic or medical claims: the system prompt explicitly forbids
statements like "it sounds like you have depression," and tells the model
to reflect feelings without labeling conditions or suggesting treatment.
Worth being upfront that this is a prompt-level guardrail, not a hard
filter — see the honest limitation on that below.

## 6. What I'd do differently with more time

A few things, roughly in order of how much they'd matter:

A real moderation/classifier API for crisis detection, instead of (or
alongside) prompt-based classification — something evaluated against an
actual labeled dataset with published precision/recall, rather than a
hand-written keyword list and a general-purpose model asked to play
classifier. Alongside that, a human escalation path: right now "surface
resources" is the ceiling of what this app does, and a real product in this
space needs a way to loop in an actual human — an on-call counselor, a
designated contact — for sustained or repeated crisis signals, with consent
obtained up front.

I'd also want output-side guardrails, not just input-side prompting.
"Don't diagnose" and "don't roleplay" are currently instructions to the
model, which in principle can still be talked around by a determined user.
A production version should scan the model's *output* for diagnostic
language or roleplay drift and intercept it the same way the crisis path
intercepts before generation even happens. In the same vein, crisis
assessment should look at a rolling window of the conversation rather than
just the latest message, to catch gradual escalation.

Smaller but real: crisis resources should be localized to wherever the user
actually is, instead of defaulting to US hotlines for everyone. Storage
should be a proper multi-user setup with real auth and encryption at rest —
the JSON file here is intentionally just a local demo. And the test suite
should grow into an automated regression set against a much larger,
held-out collection of crisis and non-crisis phrasings; what's here now is
illustrative, not comprehensive.

Last one, and probably the most important: clinical review. I wrote the
safety language in the system prompt as an engineer, not a mental-health
professional, and before any real person touched this I'd want that
reviewed properly, plus adversarial red-teaming of the crisis detector
specifically — paraphrase attacks, other languages, code-switching, the
stuff a keyword list and a single classifier prompt won't anticipate.

## 7. Judgment & ethics notes

This whole thing is built around one belief: an AI should never be the last
line of defense for someone in crisis, and it should never make itself
*feel* like a sufficient substitute for the humans and professionals a
lonely person actually needs. In practice that shows up as the crisis path
always handing off to real resources instead of trying to handle the moment
itself, the persona being barred from diagnosing anything (because a wrong
diagnosis from an AI can delay someone getting real care), and the
healthy-engagement rules existing because a "supportive" app that quietly
maximizes engagement is working against the very person it claims to help.

Where I'm least confident: the prompt-based guardrails — no roleplay, no
diagnosis, don't try to handle a crisis solo — are enforced by instruction,
not by any hard technical constraint. A sufficiently determined user could
probably get the model to drift from them over a long enough conversation.
The crisis *detection* path is hard-coded and doesn't depend on the model
behaving itself — that was the one place I wasn't willing to lean on
prompting alone. Relying on prompting for the persona rules was a
reasonable call given the scope of this project, but a real deployment
needs the output-side scanning mentioned above before I'd trust those rules
under genuinely adversarial use.
