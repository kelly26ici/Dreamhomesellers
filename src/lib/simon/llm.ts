/**
 * One model call for thread metadata: title, rolling summary, durable facts.
 *
 * This deliberately does not use Simon's `/api/chat`. That endpoint runs the
 * full agent against the listing tools and the LangGraph checkpointer; using
 * it for a title would create a parallel conversation, cost a retrieval round,
 * and couple the rail to the agent's availability. `/api/aux` is a plain,
 * tool-less model call owned by the Simon service.
 *
 * Everything here degrades: a missing endpoint, a slow provider, malformed
 * JSON, or a missing key all return `null`, and the caller keeps the snippet
 * title and the heuristic memory it already wrote.
 */

const DEFAULT_AUX_TIMEOUT_MS = 25_000;
const AUX_MODEL_TIMEOUT_SECONDS = 8;

export interface SimonThreadMeta {
  readonly title: string;
  readonly summary: string;
  readonly facts: readonly { readonly key: string; readonly value: string }[];
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function buildPrompt(input: {
  userMessage: string;
  assistantMessage: string;
  previousSummary?: string | null;
}): string {
  const previous = input.previousSummary?.trim()
    ? `\nExisting summary so far (update, do not repeat verbatim):\n${clip(
        input.previousSummary,
        1400,
      )}\n`
    : '';

  return [
    'You maintain metadata for a property-concierge chat on LUXONN, a premium',
    'Kenya-focused real-estate marketplace. You never answer the buyer.',
    '',
    'Return ONE JSON object and nothing else, with exactly these keys:',
    '{',
    '  "title": "3-7 word specific label for this conversation, title case,',
    '            no quotes, no trailing punctuation",',
    '  "summary": "2-4 sentences: what the buyer wants (location, budget,',
    '             property type, bedrooms, amenities, timeline) and what was',
    '             recommended. Under 600 characters.",',
    '  "facts": [{"key": "short_snake_case", "value": "durable fact"}]',
    '}',
    '',
    'Rules:',
    '- `facts` are durable buyer facts worth remembering across conversations',
    '  (for example budget_range, preferred_area, household, purchase_timeline).',
    '  Do not repeat transient search queries. Return [] when unsure.',
    '- Never invent a budget, location, or requirement the buyer did not state.',
    '- Never include personal data, credentials, or anything the assistant said',
    '  about being an AI.',
    '- Output raw JSON. No markdown fences, no commentary.',
    previous,
    'Buyer message:',
    clip(input.userMessage, 1600),
    '',
    'Assistant reply:',
    clip(input.assistantMessage, 2200),
  ].join('\n');
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[.,;:!?]+$/, '')
    .trim();
  if (!title) return null;
  return title.length <= 120 ? title : title.slice(0, 119).trimEnd() + '…';
}

function sanitizeFacts(
  value: unknown,
): readonly { key: string; value: string }[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const facts: { key: string; value: string }[] = [];

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const fact = typeof record.value === 'string' ? record.value.trim() : '';
    const normalizedKey = key
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);

    if (!normalizedKey || !fact || seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    facts.push({ key: normalizedKey, value: fact.slice(0, 400) });
    if (facts.length >= 12) break;
  }

  return facts;
}

/**
 * Ask Simon for title + summary + facts in one call.
 *
 * Returns `null` when the auxiliary endpoint is absent (older Simon deploys
 * answer 404) or when the model did not produce a usable object.
 */
export async function generateSimonThreadMeta(input: {
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly previousSummary?: string | null;
}): Promise<SimonThreadMeta | null> {
  const baseUrl = process.env.SIMON_API_URL?.trim();
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/aux`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: buildPrompt(input),
        timeout_seconds: AUX_MODEL_TIMEOUT_SECONDS,
      }),
      signal: AbortSignal.timeout(DEFAULT_AUX_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      // 404 is the expected state until Simon is redeployed with /api/aux;
      // it is not worth a warning on every turn.
      if (response.status !== 404) {
        console.warn(
          `[simon] aux metadata call failed: HTTP ${response.status}`,
        );
      }
      return null;
    }

    const payload = (await response.json()) as { text?: unknown };
    if (typeof payload.text !== 'string') return null;

    const parsed = extractJsonObject(payload.text);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    const title = sanitizeTitle(record.title);
    if (!title) return null;

    const summary =
      typeof record.summary === 'string' ? record.summary.trim().slice(0, 4000) : '';

    return {
      title,
      summary,
      facts: sanitizeFacts(record.facts),
    };
  } catch (error) {
    console.warn('[simon] aux metadata call error:', error);
    return null;
  }
}
