#!/usr/bin/env node
// Deterministic timetable solver over cached NUSMods data.
// Usage: node scripts/solve.mjs [plans/y2s1.json] [--top N]
//
// Reads a plan config (modules + hard/soft constraints), enumerates all
// clash-free slot assignments, scores them against soft preferences, and
// prints the best plans with NUSMods share links.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// NUSMods lessonType -> share-link abbreviation
const ABBREV = {
  'Design Lecture': 'DLEC', 'Laboratory': 'LAB', 'Lecture': 'LEC',
  'Packaged Lecture': 'PLEC', 'Packaged Tutorial': 'PTUT', 'Recitation': 'REC',
  'Sectional Teaching': 'SEC', 'Seminar-Style Module Class': 'SEM',
  'Tutorial': 'TUT', 'Tutorial Type 2': 'TUT2', 'Tutorial Type 3': 'TUT3',
  'Workshop': 'WS', 'Mini-Project': 'MP',
};

// Online sessions (e-learning venues) still clash-check — you can't attend two
// live things at once — but don't count as physical presence for soft scoring.
const isOnline = s => !s.venue || s.venue.startsWith('E-Learn');

const mins = t => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2), 10);
const hhmm = t => `${t.slice(0, 2)}:${t.slice(2)}`;

function weeksOf(w) {
  if (Array.isArray(w)) return new Set(w);
  return null; // date-ranged weeks: treat as "every week" (conservative for clashes)
}
function weeksOverlap(a, b) {
  const wa = weeksOf(a), wb = weeksOf(b);
  if (!wa || !wb) return true;
  for (const x of wa) if (wb.has(x)) return true;
  return false;
}
function sessionsClash(a, b) {
  return a.day === b.day && mins(a.startTime) < mins(b.endTime) &&
    mins(b.startTime) < mins(a.endTime) && weeksOverlap(a.weeks, b.weeks);
}

// ---------- load config + module data ----------
const argv = process.argv.slice(2);
const configPath = argv.find(a => !a.startsWith('--')) || 'plans/y2s1.json';
const topN = argv.includes('--top') ? parseInt(argv[argv.indexOf('--top') + 1], 10) : 3;
const asJson = argv.includes('--json');

const cfg = JSON.parse(await readFile(path.resolve(configPath), 'utf8'));
const semester = cfg.semester ?? 1;
const hard = cfg.hard ?? {};
const soft = cfg.soft ?? {};
const locked = cfg.locked ?? {};

const modules = [];
for (const code of cfg.modules) {
  const raw = JSON.parse(await readFile(path.join(ROOT, 'data', 'modules', `${code.toUpperCase()}.json`), 'utf8'));
  const semData = raw.semesterData.find(s => s.semester === semester);
  if (!semData) { console.error(`${code}: not offered in semester ${semester}`); process.exit(1); }
  modules.push({ code: raw.moduleCode, title: raw.title, mc: raw.moduleCredit, examDate: semData.examDate, examDuration: semData.examDuration, timetable: semData.timetable });
}

// ---------- exam clash check ----------
const byExam = new Map();
for (const m of modules) {
  if (!m.examDate) continue;
  if (!byExam.has(m.examDate)) byExam.set(m.examDate, []);
  byExam.get(m.examDate).push(m.code);
}
const examClashes = [...byExam.values()].filter(v => v.length > 1);

// ---------- build choice variables ----------
// One variable per (module, lessonType); its options are classNos, each classNo
// being ALL sessions sharing that classNo (a class can meet multiple times a week).
const variables = [];
const noTimetable = [];
for (const m of modules) {
  if (!m.timetable.length) { noTimetable.push(m.code); continue; }
  const byType = new Map();
  for (const s of m.timetable) {
    if (!byType.has(s.lessonType)) byType.set(s.lessonType, new Map());
    const byClass = byType.get(s.lessonType);
    if (!byClass.has(s.classNo)) byClass.set(s.classNo, []);
    byClass.get(s.classNo).push(s);
  }
  for (const [lessonType, byClass] of byType) {
    let options = [...byClass.entries()].map(([classNo, sessions]) => ({ module: m.code, lessonType, classNo, sessions }));
    const lock = locked[m.code]?.[lessonType];
    if (lock != null) {
      options = options.filter(o => o.classNo === String(lock));
      if (!options.length) { console.error(`${m.code} ${lessonType}: locked classNo "${lock}" not found`); process.exit(1); }
    }
    variables.push({ module: m.code, lessonType, options });
  }
}

// ---------- hard-constraint filters on single options ----------
const avoid = (hard.avoid ?? []).map(a => ({ ...a, s: mins(a.start), e: mins(a.end) }));
function violatesHard(session) {
  if (hard.earliestStart && mins(session.startTime) < mins(hard.earliestStart)) return true;
  if (hard.latestEnd && mins(session.endTime) > mins(hard.latestEnd)) return true;
  // freeDays means no PHYSICAL presence that day; online sessions are fine
  if ((hard.freeDays ?? []).includes(session.day) && !isOnline(session)) return true;
  for (const a of avoid) {
    if (a.day === session.day && mins(session.startTime) < a.e && a.s < mins(session.endTime)) return true;
  }
  return false;
}
for (const v of variables) {
  const kept = v.options.filter(o => !o.sessions.some(violatesHard));
  if (!kept.length) {
    console.error(`No valid options for ${v.module} ${v.lessonType} under hard constraints — relax something.`);
    console.error(`  all options: ${v.options.map(o => o.classNo + ' (' + o.sessions.map(s => `${s.day.slice(0, 3)} ${hhmm(s.startTime)}-${hhmm(s.endTime)}`).join('; ') + ')').join(', ')}`);
    process.exit(1);
  }
  v.options = kept;
}
variables.sort((a, b) => a.options.length - b.options.length); // fewest-options-first

// ---------- scoring ----------
function score(assignment) {
  const sessions = assignment.flatMap(o => o.sessions);
  const physical = sessions.filter(s => !isOnline(s));
  // presence-based prefs (days on campus, early starts, gaps, lunch) score
  // PHYSICAL sessions only; preferFree windows score ALL sessions since a live
  // online class still occupies the time slot.
  const byDay = new Map();
  for (const s of physical) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day).push(s);
  }
  const byDayAll = new Map();
  for (const s of sessions) {
    if (!byDayAll.has(s.day)) byDayAll.set(s.day, []);
    byDayAll.get(s.day).push(s);
  }
  let penalty = 0;
  const notes = [];

  if (soft.noLessonsBefore) {
    const cutoff = mins(soft.noLessonsBefore.time);
    const early = physical.filter(s => mins(s.startTime) < cutoff);
    if (early.length) {
      penalty += early.length * (soft.noLessonsBefore.weight ?? 3);
      notes.push(`${early.length} session(s) before ${hhmm(soft.noLessonsBefore.time)}`);
    }
  }
  if (soft.minimizeDays) {
    penalty += byDay.size * (soft.minimizeDays.weight ?? 5);
    notes.push(`${byDay.size} days on campus`);
  }
  if (soft.preferFreeDays) {
    for (const d of soft.preferFreeDays.days ?? []) {
      if (byDay.has(d)) { penalty += (soft.preferFreeDays.weight ?? 8); notes.push(`${d} not free`); }
    }
  }
  if (soft.lunchBreak) {
    for (const [day, ss] of byDay) {
      // free 60-min slot somewhere in 1100-1400?
      const busy = ss.map(s => [mins(s.startTime), mins(s.endTime)]).sort((a, b) => a[0] - b[0]);
      let ok = false, cur = 11 * 60;
      for (const [s, e] of busy) {
        if (s >= cur + 60 && cur + 60 <= 14 * 60) { ok = true; break; }
        cur = Math.max(cur, e);
      }
      if (cur + 60 <= 14 * 60) ok = true;
      if (!ok) { penalty += (soft.lunchBreak.weight ?? 2); notes.push(`no lunch gap on ${day}`); }
    }
  }
  for (const w of soft.preferFree ?? []) {
    const ws = mins(w.start), we = mins(w.end);
    let overlapMins = 0;
    for (const s of byDayAll.get(w.day) ?? []) {
      overlapMins += Math.max(0, Math.min(we, mins(s.endTime)) - Math.max(ws, mins(s.startTime)));
    }
    if (overlapMins > 0) {
      penalty += (overlapMins / 60) * (w.weight ?? 4);
      notes.push(`${(overlapMins / 60).toFixed(1)}h clash with "${w.label ?? w.day + ' ' + w.start}"`);
    }
  }
  if (soft.compactness) {
    let gapH = 0;
    for (const ss of byDay.values()) {
      const busy = ss.map(s => [mins(s.startTime), mins(s.endTime)]).sort((a, b) => a[0] - b[0]);
      let end = busy[0][1];
      for (const [s, e] of busy.slice(1)) { if (s > end) gapH += (s - end) / 60; end = Math.max(end, e); }
    }
    penalty += gapH * (soft.compactness.weight ?? 1);
    if (gapH > 0) notes.push(`${gapH.toFixed(1)}h of gaps`);
  }
  return { penalty, notes };
}

// ---------- search: DFS with incremental clash pruning ----------
const best = []; // keep topN lowest-penalty, plus dedupe by link
let valid = 0, nodes = 0;
const NODE_CAP = 5_000_000;

function dfs(i, chosen, placed) {
  if (++nodes > NODE_CAP) return;
  if (i === variables.length) {
    valid++;
    const { penalty, notes } = score(chosen);
    best.push({ penalty, notes, assignment: [...chosen] });
    best.sort((a, b) => a.penalty - b.penalty);
    if (best.length > Math.max(topN, 10)) best.pop();
    return;
  }
  for (const opt of variables[i].options) {
    let clash = false;
    outer: for (const s of opt.sessions) {
      for (const p of placed) if (sessionsClash(s, p)) { clash = true; break outer; }
    }
    if (clash) continue;
    chosen.push(opt);
    placed.push(...opt.sessions);
    dfs(i + 1, chosen, placed);
    placed.length -= opt.sessions.length;
    chosen.pop();
  }
}
dfs(0, [], []);

// ---------- output ----------
function shareLink(assignment) {
  const byMod = new Map();
  for (const o of assignment) {
    if (!byMod.has(o.module)) byMod.set(o.module, []);
    byMod.get(o.module).push(`${ABBREV[o.lessonType] ?? o.lessonType}:${o.classNo}`);
  }
  const q = [...byMod.entries()].map(([m, parts]) => `${m}=${parts.join(',')}`).join('&');
  return `https://nusmods.com/timetable/sem-${semester}/share?${q}`;
}

function renderGrid(assignment) {
  const sessions = assignment.flatMap(o => o.sessions.map(s => ({ ...s, module: o.module })));
  let out = '';
  for (const day of DAYS) {
    const ss = sessions.filter(s => s.day === day).sort((a, b) => mins(a.startTime) - mins(b.startTime));
    if (!ss.length) continue;
    out += `  ${day}\n`;
    for (const s of ss) {
      const wk = Array.isArray(s.weeks) && s.weeks.length < 10 ? ` [wks ${s.weeks.join(',')}]` : '';
      const where = isOnline(s) ? '💻 online' : `@ ${s.venue}`;
      out += `    ${hhmm(s.startTime)}–${hhmm(s.endTime)}  ${s.module} ${ABBREV[s.lessonType] ?? s.lessonType} ${s.classNo} ${where}${wk}\n`;
    }
  }
  return out;
}

if (asJson) {
  console.log(JSON.stringify({ valid, examClashes, noTimetable, plans: best.slice(0, topN).map(b => ({ penalty: b.penalty, notes: b.notes, link: shareLink(b.assignment), assignment: b.assignment.map(o => ({ module: o.module, lessonType: o.lessonType, classNo: o.classNo })) })) }, null, 2));
  process.exit(0);
}

const totalMc = modules.reduce((a, m) => a + parseFloat(m.mc), 0);
console.log(`Modules: ${modules.map(m => m.code).join(', ')} (${totalMc} MCs) — sem ${semester}`);
if (noTimetable.length) console.log(`⚠️  No timetable data (slots allocated separately or not yet released) — counted for MCs/exams but NOT scheduled: ${noTimetable.join(', ')}`);
if (examClashes.length) console.log(`⚠️  EXAM CLASH: ${examClashes.map(c => c.join(' & ')).join('; ')}`);
console.log(`Valid clash-free timetables: ${valid}${nodes > NODE_CAP ? ' (search capped)' : ''}\n`);

if (!valid) {
  console.log('No clash-free timetable exists under the current hard constraints.');
  process.exit(2);
}
// dedupe identical links (e.g. same choice sets in different order)
const seen = new Set();
let rank = 0;
for (const b of best) {
  const link = shareLink(b.assignment);
  if (seen.has(link)) continue;
  seen.add(link);
  if (++rank > topN) break;
  console.log(`── Option ${rank} — penalty ${b.penalty.toFixed(1)} ──`);
  if (b.notes.length) console.log(`  tradeoffs: ${[...new Set(b.notes)].join('; ')}`);
  console.log(renderGrid(b.assignment));
  console.log(`  ${link}\n`);
}
