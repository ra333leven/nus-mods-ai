#!/usr/bin/env node
// Convert a NUSMods share link into busy blocks (e.g. your gf's timetable),
// so her free windows can be turned into preferFree constraints.
// Usage: node scripts/import-link.mjs "<share url>" me/gf-timetable.json
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACAD_YEAR = process.env.ACAD_YEAR || '2026-2027';

const ABBREV_TO_TYPE = {
  DLEC: 'Design Lecture', LAB: 'Laboratory', LEC: 'Lecture', PLEC: 'Packaged Lecture',
  PTUT: 'Packaged Tutorial', REC: 'Recitation', SEC: 'Sectional Teaching',
  SEM: 'Seminar-Style Module Class', TUT: 'Tutorial', TUT2: 'Tutorial Type 2',
  TUT3: 'Tutorial Type 3', WS: 'Workshop', MP: 'Mini-Project',
};

const [url, outPath] = process.argv.slice(2);
if (!url) { console.error('usage: node scripts/import-link.mjs "<nusmods share url>" [out.json]'); process.exit(1); }

const u = new URL(url);
const semMatch = u.pathname.match(/sem-(\d)/);
const semester = semMatch ? parseInt(semMatch[1], 10) : 1;

const blocks = [];
for (const [code, val] of u.searchParams) {
  const res = await fetch(`https://api.nusmods.com/v2/${ACAD_YEAR}/modules/${code.toUpperCase()}.json`);
  if (!res.ok) { console.error(`${code}: fetch failed (${res.status})`); continue; }
  const mod = await res.json();
  const semData = mod.semesterData.find(s => s.semester === semester);
  if (!semData) { console.error(`${code}: no sem ${semester} data`); continue; }
  for (const part of val.split(',').filter(Boolean)) {
    const [abbrev, classNo] = part.split(':');
    const type = ABBREV_TO_TYPE[abbrev] ?? abbrev;
    const sessions = semData.timetable.filter(s => s.lessonType === type && s.classNo === classNo);
    if (!sessions.length) console.error(`${code} ${part}: no matching sessions`);
    for (const s of sessions) {
      blocks.push({ day: s.day, start: s.startTime, end: s.endTime, weeks: s.weeks, label: `${code} ${abbrev} ${classNo}` });
    }
  }
}

const order = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5 };
blocks.sort((a, b) => (order[a.day] - order[b.day]) || (a.start.localeCompare(b.start)));

const out = JSON.stringify({ source: url, semester, busy: blocks }, null, 2);
if (outPath) {
  await mkdir(path.dirname(path.resolve(ROOT, outPath)), { recursive: true });
  await writeFile(path.resolve(ROOT, outPath), out);
  console.log(`wrote ${blocks.length} busy blocks to ${outPath}`);
} else {
  console.log(out);
}
