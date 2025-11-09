import fs from 'fs';
import path from 'path';

type Source = 'heuristic' | 'ai' | 'cache';

interface CacheEntry {
  healed: string;
  source: Source;
  ts: string; // ISO timestamp
}

type CacheShape = Record<string, CacheEntry>;

const CACHE_PATH = path.resolve(process.cwd(), 'healed-locators.json');

function readFile(): CacheShape {
  try {
    if (!fs.existsSync(CACHE_PATH)) return {};
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[CACHE] Failed to read cache:', e);
    return {};
  }
}

function writeFile(obj: CacheShape) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(obj, null, 2), 'utf8');
    console.log(`[CACHE] Saved ${Object.keys(obj).length} entries`);
  } catch (e) {
    console.warn('[CACHE] Failed to write cache:', e);
  }
}

/** Get a healed selector for a previously broken selector, or undefined. */
export function getHealed(broken: string): CacheEntry | undefined {
  return readFile()[broken];
}

/** Persist a healed selector. */
export function setHealed(broken: string, healed: string, source: Source) {
  const db = readFile();
  db[broken] = { healed, source, ts: new Date().toISOString() };
  writeFile(db);
}