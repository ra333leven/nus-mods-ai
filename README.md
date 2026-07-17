# nus-mods-ai

Tell an AI what you want your NUS semester to look like. Get back a
clash-free timetable as a [NUSMods](https://nusmods.com) link you can
import and view.

```
"I'm taking CS2106, CS2109S and CS2103T. No classes before 10,
 keep Tue/Thu lunch free for my partner, minimize campus days."
→ https://nusmods.com/timetable/sem-1/share?CS2106=LEC:1,TUT:05,...
```

## Get started

You need [Claude Code](https://claude.com/claude-code) (or any coding agent
that reads `AGENTS.md`) and Node ≥ 18. No npm install needed.

```sh
git clone https://github.com/ra333leven/nus-mods-ai
cd nus-mods-ai
claude
> plan my semester
```

Or open the folder in the Claude Code desktop app and start talking.

That's it. On first run the agent interviews you (year, major, modules
taken, preferences), saves a profile, and remembers it for next time. Then
just talk: add modules, change constraints, ask what to take next semester,
match a friend's timetable. Everything personal stays on your machine
(`me/` and `plans/` are gitignored).

## How it works

The AI never picks class slots — it only translates your words into a
constraints file. A small deterministic solver then enumerates every
clash-free timetable from real NUSMods data, ranks them by your
preferences, and produces the share link. The AI explains the tradeoffs;
the solver guarantees the schedule is valid.

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
