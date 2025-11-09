# HealWithPlaywright

Lightweight Playwright helper that tries to "heal" broken selectors in E2E tests.  
It uses a fast heuristic first and can optionally fall back to an LLM (OpenAI) to suggest a new CSS selector. Healed selectors are cached to avoid repeated AI calls.

## Features
- Heuristic-based locator recovery for common patterns (ids, data-test, aria-label, text).
- Optional AI fallback (OpenAI) when heuristics fail.
- Simple JSON cache of healed locators (`healed-locators.json`).

## Quick start

Prerequisites:
- Node 18+ and npm or pnpm
- Playwright (project includes tests)
- (Optional) OpenAI API key for AI fallback

Install dependencies:
```bash
npm install
```

Run tests:
```bash
npx playwright test
```

Run a single spec:
```bash
npx playwright test tests/login.spec.ts
```

## Configuration (.env)

Create a `.env` in project root (example):
```properties
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5
HEALER_MODE=heuristic      # heuristic | mock | live | disabled
HEALER_MAX_HTML_CHARS=8000
HEALER_MAX_RETRIES=6
HEALER_BACKOFF_BASE_MS=500
AI_DISABLED=false
```

Important:
- Set `OPENAI_API_KEY` to enable AI fallback.
- Ensure `AI_DISABLED` is `false` or absent to allow AI.
- `HEALER_MODE` controls behavior during tests.

## How it works (high level)
1. When a locator fails, the healer attempts:
   - Cache lookup (`utils/cache.ts`)
   - Heuristic healing (`healing/AILocator.ts`)
   - AI healing (`aiHeal`), if enabled and key present
2. If a healed selector is found and is clickable in the DOM, it is returned and cached.