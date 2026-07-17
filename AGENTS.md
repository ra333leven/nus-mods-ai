# NUS Semester Planner

Personal tool: the user talks in natural language about their semester
("I want CS2106, no 8ams, Fridays free, lunch with my partner on Tue/Thu"),
and the agent turns that into constraints, runs a deterministic solver over
cached NUSMods data, and returns a NUSMods share link they can import
visually.

**Golden rule: never pick class numbers (slots) yourself.** You translate
natural language → the plan config JSON. The solver picks slots. You explain
the results. If you hand-write a share link you WILL hallucinate a classNo.

## First-time setup (new user)

If `me/profile.md` doesn't exist, this is a fresh clone: copy
`me/profile.template.md` → `me/profile.md` and `plans/example.json` →
`plans/<sem>.json` (e.g. `plans/y2s1.json`), then interview the user for the
basics (year/major, modules taken, standing preferences). `me/` and `plans/`
are gitignored — personal data never leaves the machine.

## Starting a conversation

At the start of a new conversation, read `me/profile.md` and the current
plan in `plans/` BEFORE responding, then orient the user: say what you know
(current semester plan, modules in it, standing preferences) in a sentence
or two so they can correct anything stale.

Ask questions rather than guess — but batch them (2–4 at once, use the
question UI if available) instead of interrogating one at a time. Always ask
when:

- it's unclear **which semester/plan** the request is about;
- a new constraint is ambiguous between **hard and soft** ("no 8ams" — can't,
  or would rather not?);
- the profile has **gaps that matter for this request** (e.g. advising on
  what to take next but "Modules taken" is empty);
- the request **conflicts with a standing preference** in the profile —
  confirm which wins before overwriting anything.

Don't ask about things the profile or plan already answers, and don't
re-confirm standing preferences every session — assume they hold unless the
user says otherwise. If the user opens with a fully-specified request, just
do it; the orientation blurb is still worth one line, the questions are not.

## Workflow for any planning request

1. Read `me/profile.md` (who the user is, mods taken, standing prefs) and
   the current plan in `plans/`. Update `me/profile.md` when new durable
   facts come up (mods taken, preferences, goals).
2. If new modules are mentioned: `node scripts/fetch.mjs CS2106 CS2109S ...`
   (caches to `data/modules/`). Check the output — it warns if a module
   isn't offered this semester.
3. Translate the request into edits to the plan config (schema below).
4. Run `node scripts/solve.mjs plans/<sem>.json` (add `--top 5` for more
   options, `--json` for machine-readable output).
5. Present: the schedule grid, the tradeoffs the solver reported, exam-clash
   warnings, and the share link. Explain *why* in plain English.
6. **Render + screenshot, don't just link.** Open the share link in the
   Claude browser and screenshot the timetable for the user — seeing it
   inline beats clicking a link. Steps: `preview_start` with the URL → an
   "outdated browser" interstitial may appear; click "Continue to NUSMods" →
   screenshot. This also VERIFIES the link: check every module's slots
   actually render (a wrong classNo silently drops that module's lessons).
   Share links get truncated by chat markdown — also give the raw URL in a
   code block, and remind them to click the green Import button.

For module advice (what to take, prereqs, workload): the cached module JSON
has `prereqTree`, `preclusion`, `workload`, `description`, and
`semesterData[].examDate`. Fetch and read them. `data/moduleList.json` has
every module code+title for lookup (refresh: `node scripts/fetch.mjs --list`).

## Plan config schema (`plans/*.json`)

- `modules`: module codes to take. `semester`: 1 or 2.
- `locked`: `{ "CS2106": { "Lecture": "1" } }` — force a specific classNo
  (use when the user says "keep my CS2106 lecture").
- `hard` (a plan violating these is rejected):
  - `earliestStart` / `latestEnd`: "0900" / "1800" or null
  - `freeDays`: ["Friday"] — no physical classes that day
  - `avoid`: [{ "day", "start", "end", "label" }] — blocked windows
- `soft` (weighted penalties; higher weight = matters more, typical 1–10):
  - `noLessonsBefore`: { time, weight } — per early session
  - `minimizeDays`: { weight } — per day on campus
  - `preferFreeDays`: { days, weight } — per non-free preferred day
  - `lunchBreak`: { weight } — per day with no free hour in 11:00–14:00
  - `preferFree`: [{ day, start, end, label, weight }] — per hour of overlap
    (this is how "time with my partner" is encoded)
  - `compactness`: { weight } — per hour of gap between classes

Hard vs soft: "I can't do X" → hard. "I'd rather not" → soft. If the solver
says no valid timetable exists, relax hard constraints into soft ones and rerun.

### Online lessons

Many CS lectures are e-learning (venue starts with `E-Learn` or is empty). The
solver treats them as: still clash-checked (registered mods can't overlap), but
NOT physical presence — they're exempt from `freeDays` (hard), `minimizeDays`,
`preferFreeDays`, `noLessonsBefore`, `lunchBreak`, and `compactness`. They DO
still count against `preferFree` windows (a live online class occupies the
slot) and against `earliestStart`/`latestEnd`/`avoid` (hard means hard). The
grid marks them 💻.

## Degree progress

If the user keeps a degree-requirements document (Google Sheet, Notion, etc.),
record where it lives and how to read it in `me/profile.md`, and keep a
snapshot in `me/degree-plan.md` for cross-semester planning. Always verify
prereqs from the cached module JSON (`prereqTree`) before proposing modules —
don't trust memory.

Official references (fetch these when advising on requirements, focus areas,
or which semester a course will be offered — SoC's schedule page knows future
offerings that the NUSMods API doesn't):

- [BComp (Hons) CS curriculum](https://www.comp.nus.edu.sg/programmes/ug/cs/curr/)
- [SoC course schedule](https://www.comp.nus.edu.sg/cug/soc-sched/) — planned offerings by AY/sem
- [CS focus areas](https://www.comp.nus.edu.sg/programmes/ug/focus/) — breadth & depth groupings

## Matching someone else's timetable

1. Get their NUSMods share link →
   `node scripts/import-link.mjs "<url>" me/partner-timetable.json`
2. Read the busy blocks, work out their FREE windows, ask/infer which the
   user wants to share (lunch? afternoons?), add those as `preferFree`
   entries.

## Repo map

- `scripts/fetch.mjs` — fetch+cache module data (env `ACAD_YEAR`, default 2026-2027)
- `scripts/solve.mjs` — solver: config → top-N timetables + share links
- `scripts/import-link.mjs` — share link → busy-blocks JSON
- `data/` — cached NUSMods JSON (gitignored; regenerable, cheap to refetch
  with `--force`)
- `plans/` — plan configs, one per semester (gitignored except example.json)
- `me/` — persistent user facts (gitignored except profile.template.md).
  KEEP profile.md CURRENT.
- `CLAUDE.md` — pointer here; this file (AGENTS.md) is the canonical doc

No dependencies, no build step — plain Node ≥18. NUSMods data updates daily;
`--force` refetch if slot availability matters (e.g. right before ModReg).
