# nus-mods-ai

Plan your NUS semester by talking to an AI agent in natural language, and get
back a ranked, clash-free timetable as a [NUSMods](https://nusmods.com) share
link you can import and view.

```
"I'm taking CS2106, CS2109S and CS2103T. No physical classes before 10,
 keep Tue/Thu lunch free for my partner, minimize campus days."
→ https://nusmods.com/timetable/sem-1/share?CS2106=LEC:1,TUT:05,...
```

The trick: the LLM never picks class slots (it would hallucinate them). It
translates your words into a constraints JSON; a small deterministic solver
enumerates every clash-free timetable from cached NUSMods API data, scores
them against your preferences, and emits the share link. NUSMods renders it.

## Quickstart

Requirements: [Claude Code](https://claude.com/claude-code) (or any coding
agent that reads `AGENTS.md`), Node ≥ 18. Zero npm dependencies.

```sh
git clone https://github.com/ra333leven/nus-mods-ai
cd nus-mods-ai
claude
> plan my semester. I'm a Y2 CS student, I've taken ..., I want ...
```

The agent bootstraps your profile (`me/profile.md`), fetches module data,
solves, and shows you timetable options with tradeoffs. Everything personal
(`me/`, `plans/`) is gitignored and stays on your machine.

## Manual usage (no agent)

```sh
node scripts/fetch.mjs CS2100 CS2103T CS2109S   # cache NUSMods data
cp plans/example.json plans/y2s1.json           # edit constraints by hand
node scripts/solve.mjs plans/y2s1.json --top 5  # ranked timetables + links
node scripts/import-link.mjs "<share url>" me/partner-timetable.json
                                                # someone else's link → busy blocks
```

Constraint schema, online-lesson semantics, and the full agent workflow are
documented in [AGENTS.md](AGENTS.md).

## How it works

```
natural language ──► agent (extracts constraints) ──► plans/<sem>.json
                                                          │
                       data/ (cached NUSMods API) ────────┤
                                                          ▼
                                      scripts/solve.mjs (deterministic DFS
                                      + clash pruning + weighted scoring)
                                                          │
                                                          ▼
                                      NUSMods share link ──► import & view
```

Data comes from the public [NUSMods API](https://api.nusmods.com/v2/) (no
auth; refreshed daily upstream). Set `ACAD_YEAR` to override the default
academic year in the scripts.

## License

MIT
