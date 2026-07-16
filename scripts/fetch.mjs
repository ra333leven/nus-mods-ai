#!/usr/bin/env node
// Fetch and cache NUSMods module data.
// Usage:
//   node scripts/fetch.mjs CS2106 CS2103T ...   # fetch modules into data/modules/
//   node scripts/fetch.mjs --list               # refresh data/moduleList.json
//   node scripts/fetch.mjs --force CS2106       # refetch even if cached
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACAD_YEAR = process.env.ACAD_YEAR || '2026-2027';
const BASE = `https://api.nusmods.com/v2/${ACAD_YEAR}`;

const args = process.argv.slice(2);
const force = args.includes('--force');
const wantList = args.includes('--list');
const codes = args.filter(a => !a.startsWith('--')).map(c => c.toUpperCase());

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

await mkdir(path.join(ROOT, 'data', 'modules'), { recursive: true });

if (wantList) {
  const list = await fetchJson(`${BASE}/moduleList.json`);
  await writeFile(path.join(ROOT, 'data', 'moduleList.json'), JSON.stringify(list));
  console.log(`moduleList.json: ${list.length} modules (AY ${ACAD_YEAR})`);
}

for (const code of codes) {
  const dest = path.join(ROOT, 'data', 'modules', `${code}.json`);
  if (!force && await exists(dest)) { console.log(`${code}: cached`); continue; }
  try {
    const mod = await fetchJson(`${BASE}/modules/${code}.json`);
    await writeFile(dest, JSON.stringify(mod, null, 1));
    const sems = mod.semesterData.map(s => s.semester).join(',');
    console.log(`${code}: ${mod.title} [sems ${sems}] (${mod.moduleCredit} MC)`);
  } catch (e) {
    console.error(`${code}: FAILED — ${e.message}`);
    process.exitCode = 1;
  }
}
