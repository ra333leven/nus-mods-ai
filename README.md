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

That's it. On first run the agent interviews you (year, major, modules
taken, preferences), saves a profile, and remembers it for next time. Then
just talk: add modules, change constraints, ask what to take next semester,
match a friend's timetable. Everything personal stays on your machine
(`me/` and `plans/` are gitignored).

## Why it doesn't hallucinate your timetable

The AI never picks class slots — it only translates your words into a
constraints file. A small deterministic solver then enumerates every
clash-free timetable from real NUSMods data, ranks them by your
preferences, and produces the share link. The AI explains the tradeoffs;
the solver guarantees the schedule is valid.

Data comes from the public [NUSMods API](https://api.nusmods.com/v2/),
cached locally.

## For the curious

You can also run the scripts by hand (`scripts/fetch.mjs`,
`scripts/solve.mjs`, `scripts/import-link.mjs`) and edit the constraint
JSON yourself — see [AGENTS.md](AGENTS.md) for the schema and full
workflow. But the whole point is that you shouldn't have to.

## License

MIT
