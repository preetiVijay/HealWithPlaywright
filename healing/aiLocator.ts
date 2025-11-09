import { load } from 'cheerio';
import axios from 'axios';
import { getHealed, setHealed } from '../utils/cache';
import dotenv from 'dotenv';
dotenv.config();

type HealSource = 'cache' | 'heuristic' | 'ai';

export interface HealOptions {
  /** Try heuristic first (recommended). Defaults to true. */
  preferHeuristic?: boolean;
  /** Allow AI fallback if heuristic fails and key exists. Defaults to false. */
  allowAI?: boolean;
  /** OpenAI model, if AI is allowed. */
  model?: string;
  /** Max AI retries on 429. */
  maxAIRetries?: number;
  /** Initial backoff delay for AI (ms). */
  backoffMs?: number;
}

/** Returns a healed selector or null. */
export async function healSelector(
  failedSelector: string,
  htmlSnapshot: string,
  opts: HealOptions = {}
): Promise<string | null> {
  const {
    preferHeuristic = true,
    allowAI = true,
    model = process.env.OPENAI_MODEL || 'gpt-4o-mini',
    maxAIRetries = 6,
    backoffMs = 500
  } = opts;

  const $ = load(htmlSnapshot);

  // 1) Cache
  const fromCache = getHealed(failedSelector);
  if (fromCache && isClickableSelector($, fromCache.healed)) {
    console.log(`[HEALER] Using cached selector: ${fromCache.healed}`);
    return fromCache.healed;
  }

  // 2) Heuristic
  if (preferHeuristic) {
    console.log(`[HEALER] Trying heuristic healing for "${failedSelector}"`);
    const heuristic = heuristicHeal($, failedSelector);
    // const heuristic = null;
    if (heuristic && isClickableSelector($, heuristic)) {
      console.log(`[HEALER] Heuristic found "${heuristic}"`);
      setHealed(failedSelector, heuristic, 'heuristic');
      return heuristic;
    } else {
      console.log(`[HEALER] Heuristic could not find a valid clickable target.`);
    }
  }

  // 3) AI fallback (optional)
  if (allowAI && process.env.OPENAI_API_KEY) {
    console.log(`[HEALER] Falling back to AI for "${failedSelector}"`);
    const ai = await aiHeal($, failedSelector, htmlSnapshot, {
      model,
      maxAIRetries,
      backoffMs
    });
    if (ai && isClickableSelector($, ai)) {
      console.log(`[HEALER] AI found "${ai}"`);
      setHealed(failedSelector, ai, 'ai');
      return ai;
    }
    console.warn(`[HEALER] AI fallback failed or returned non-clickable selector.`);
  }

  console.warn(`[HEALER] Failed to heal selector "${failedSelector}"`);
  return null;
}

/* --------------------------- Heuristic logic --------------------------- */

/** Return a *clickable* selector for SauceDemo login (and similar UIs), or null. */
function heuristicHeal($: any, failedSelector: string): string | null {
  const tokens = extractTokens(failedSelector);
  console.log(`[HEALER] Heuristic extracted tokens: ${tokens.join(', ') || '(none)'}`);

  // Consider only clickable candidates
  const candidates: any[] = [];
  const pushIfTag = (el: any) => { if (el && el.type === 'tag') candidates.push(el); };
  [
    'button',
    'input[type="submit"]',
    'input[type="button"]',
    '[role="button"]',
    'a.btn',
    'a[role="button"]'
  ].forEach(sel => $(sel).each((_: number, el: Element) => pushIfTag(el)));
  if (!candidates.length) return null;

  let bestSel = '';
  let bestScore = -Infinity;

  for (const el of candidates) {
    const attribs = (el as any)?.attribs || {};
    const tag = (el as any)?.name || '';
    const text = $(el).text().trim().toLowerCase();

    // quick negative filter: avoid containers/wrappers if they ever sneak in
    const id = (attribs.id || '').toLowerCase();
    const cls = (attribs.class || '').toLowerCase();
    const looksContainer = containsAny(id + ' ' + cls, ['container', 'wrapper', 'form', 'box', 'panel', 'section']);
    if (looksContainer) continue;

    let s = 0;

    // Tag preference
    if (tag === 'button') s += 8;
    if (tag === 'input' && /^(submit|button)$/i.test(attribs.type || '')) s += 8;
    if (tag === 'a') s += 3;

    // Attribute matches
    // Strong weights for id/data-test exact "login-button"
    if (eq(attribs['data-test'], 'login-button')) s += 50;
    if (eq(attribs.id, 'login-button')) s += 50;

    // Token matches by attribute importance
    s += tokenMatchScore(tokens, attribs.id, 12);
    s += tokenMatchScore(tokens, attribs['data-test'], 14);
    s += tokenMatchScore(tokens, attribs['data-testid'], 10);
    s += tokenMatchScore(tokens, attribs.name, 8);
    s += tokenMatchScore(tokens, attribs['aria-label'], 6);
    s += tokenMatchScore(tokens, attribs.value, 4);
    s += tokenMatchScore(tokens, attribs.class, 2);

    // Visible text hint
    s += tokenMatchScore(tokens, text, 6);

    // Penalties if attribute contains misleading words
    if (containsAny((attribs['data-test'] || '').toLowerCase(), ['container', 'wrapper'])) s -= 30;
    if (containsAny((attribs.id || '').toLowerCase(), ['container', 'wrapper'])) s -= 30;

    // If it has both "login" and "button" anywhere in id/data-test, big bonus
    const iddt = (attribs.id || '') + ' ' + (attribs['data-test'] || '');
    if (containsAll(iddt.toLowerCase(), ['login', 'button'])) s += 40;

    // Build selector preference: id > data-test > data-testid > name[type] > aria-label > class
    const candidateSelector = buildBestSelectorFor(el);

    // Slight bonus if the final selector looks nice (short & robust)
    if (/^#[-a-zA-Z0-9_]+$/.test(candidateSelector)) s += 8;
    if (/^\[data-test=/.test(candidateSelector)) s += 6;

    if (s > bestScore) {
      bestScore = s;
      bestSel = candidateSelector;
    }
  }

  if (!bestSel) return null;

  // Guard: never return anything that clearly references a container
  if (/(^|["'\-\s])(login-container|wrapper|container)(["'\-\s]|$)/i.test(bestSel)) {
    return null;
  }

  return bestSel;
}

function extractTokens(sel: string): string[] {
  const raw = sel
    .replace(/[#\.\[\]=:"']/g, ' ')
    .split(/[^a-zA-Z0-9]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  // de-duplicate & keep meaningful tokens
  const dedup = Array.from(new Set(raw)).filter(t => t.length >= 3);
  // Put "login" and "button" early if present
  dedup.sort((a, b) => {
    const rank = (t: string) => (t === 'login' ? -2 : t === 'button' ? -1 : 0);
    return rank(a) - rank(b);
  });
  return dedup;
}

function tokenMatchScore(tokens: string[], value: any, weightPerHit: number): number {
  if (!value) return 0;
  const v = String(value).toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (v.includes(t)) score += weightPerHit;
  }
  return score;
}

function containsAny(hay: string, needles: string[]): boolean {
  return needles.some(n => hay.includes(n));
}
function containsAll(hay: string, needles: string[]): boolean {
  return needles.every(n => hay.includes(n));
}
function eq(a: any, b: string): boolean {
  return String(a || '').toLowerCase() === b.toLowerCase();
}

function buildBestSelectorFor(el: any): string {
  const attribs = (el as any)?.attribs || {};
  const tag = (el as any)?.name || 'div';

  const id = attribs.id;
  if (id && !/container|wrapper/i.test(id)) return `#${cssEscape(id)}`;

  const dt = attribs['data-test'];
  if (dt && !/container|wrapper/i.test(dt)) return `[data-test="${cssEscape(dt)}"]`;

  const dti = attribs['data-testid'];
  if (dti) return `[data-testid="${cssEscape(dti)}"]`;

  if (attribs.name) return `${tag}[name="${cssEscape(attribs.name)}"]`;

  if (attribs['aria-label']) return `${tag}[aria-label*="${cssEscape(attribs['aria-label'])}"]`;

  // Last resort: first class name
  if (attribs.class) {
    const c = String(attribs.class).trim().split(/\s+/).filter(Boolean)[0];
    if (c && !/container|wrapper/i.test(c)) return `.${cssEscape(c)}`;
  }

  // Absolute fallback
  return tag;
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function isClickableSelector($: any, selector: string): boolean {
  try {
    const nodes = $(selector);
    if (!nodes || nodes.length === 0) return false;
    // Ensure at least one matched node is a clickable-ish tag
    const arr: any[] = [];
    nodes.each((_: number, el: any) => { if (el && el.type === 'tag') arr.push(el); });
    return arr.some(el => {
      const name = (el as any)?.name || '';
      const a = (el as any)?.attribs || {};
      if (name === 'button') return true;
      if (name === 'input' && /^(submit|button)$/i.test(a.type || '')) return true;
      if (name === 'a' && ((a.role || '').toLowerCase() === 'button' || /\bbtn\b/.test(a.class || ''))) return true;
      return false;
    });
  } catch {
    return false;
  }
}

/* --------------------------- AI fallback (optional) --------------------------- */

async function aiHeal(
  $: any,
  failedSelector: string,
  htmlSnapshot: string,
  cfg: { model: string; maxAIRetries: number; backoffMs: number }
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  let delay = cfg.backoffMs;
  for (let attempt = 1; attempt <= cfg.maxAIRetries; attempt++) {
    try {
      const prompt = buildAIPrompt(failedSelector, htmlSnapshot);

      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: cfg.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 50
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
      const firstLine = raw.split('\n')[0].trim();
      const cleaned = firstLine.replace(/^`+|`+$/g, '').replace(/^"+|"+$/g, '');

      // Validate it's clickable in this DOM
      if (cleaned && isClickableSelector($, cleaned)) return cleaned;

      // If the model spits a container, discard
      if (/login-container/i.test(cleaned)) return null;
      // Otherwise try next attempt (maybe a different suggestion)
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 429 && attempt < cfg.maxAIRetries) {
        console.warn(`[HEALER] Rate-limited. Retrying in ${delay}ms (attempt ${attempt}/${cfg.maxAIRetries})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      console.warn(`[HEALER] AI healing failed: ${e?.message || e}`);
      return null;
    }
  }
  return null;
}

function buildAIPrompt(failedSelector: string, htmlSnapshot: string): string {
  return `You are helping fix a broken CSS selector in an end-to-end test.
Failed selector: ${failedSelector}

HTML snapshot (truncated):
${htmlSnapshot.slice(0, 12000)}

Return ONLY one line: a single CSS selector that clicks the actual 'Login' button (not any container/wrapper). Prefer id or [data-test] if available.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}