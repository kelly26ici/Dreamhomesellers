/**
 * Server-safe Simon chat types and pure helpers.
 *
 * These live outside `use-simon-runtime.ts` because that module is a client
 * component: route handlers cannot import from it, and both sides need the
 * same persisted-row shape and the same deterministic memory heuristics.
 * Nothing here reads the clock, the environment, or a database.
 */

import type { SimonListingCardRef, SimonSource } from './types';

/**
 * A live concierge tool call during a streamed turn. Frames arrive as
 * `tool-started` / `tool-finished` / `tool-error`; statuses mirror those
 * without inventing a lifecycle the server does not authorize.
 */
export interface SimonToolActivity {
  readonly id: string;
  readonly name: string;
  readonly status: 'running' | 'done' | 'failed';
}

export interface SimonNotice {
  readonly kind: 'rate-limited' | 'error';
  readonly text: string;
  readonly retryAfterSeconds?: number;
}

/**
 * One row of the Simon thread. Fully hydrated answers (fallback path)
 * carry cards / follow-ups / source; streamed answers grow tools + text
 * while `streaming` is true.
 */
export interface SimonChatEntry {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** Assistant entries render these as progress rows while active. */
  readonly tools?: readonly SimonToolActivity[];
  readonly listingCards?: readonly SimonListingCardRef[];
  readonly suggestedFollowUps?: readonly string[];
  readonly source?: SimonSource;
  readonly streaming?: boolean;
  /**
   * Fixed creation time for rows that exist during prerender (the welcome
   * row). assistant-ui fills a missing `createdAt` with a no-arg
   * `new Date()`, which cacheComponents rejects in the static shell;
   * runtime rows omit it and are stamped in the browser, where reading the
   * clock is allowed.
   */
  readonly createdAt?: Date;
}

/** One thread as the history rail needs it. */
export interface StoredSimonThread {
  readonly id: string;
  readonly title: string;
  readonly titleSource: 'snippet' | 'llm' | 'user';
  readonly lastMessageAt: string | null;
  readonly createdAt: string | null;
}

/** One persisted message as `simon_thread_get` returns it. */
export interface StoredSimonMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly metadata?: Record<string, unknown> | null;
  readonly client_message_id?: string | null;
  readonly referenced_listing_ids?: readonly string[] | null;
  readonly suggested_follow_ups?: readonly string[] | null;
  readonly created_at?: string | null;
}

export interface StoredSimonThreadDetail {
  readonly thread: StoredSimonThread & {
    readonly summary: string | null;
    readonly summaryFacts: readonly string[];
    readonly expiresAt: string | null;
  };
  readonly messages: readonly StoredSimonMessage[];
}

export interface StoredSimonMemory {
  readonly id: string;
  readonly kind: 'preference' | 'fact';
  readonly key: string;
  readonly value: string;
  readonly sourceThreadId?: string | null;
  readonly updatedAt: string | null;
  readonly expiresAt: string | null;
}

/** A memory candidate produced by the deterministic extractor. */
export interface SimonMemoryCandidate {
  readonly kind: 'preference' | 'fact';
  readonly key: string;
  readonly value: string;
}

const TITLE_SNIPPET_MAX = 60;

/**
 * One-line, length-bounded thread label. The snippet is written immediately so
 * the rail never shows a blank row while the model call is in flight; the
 * server-side title pass may replace it later, and a user rename wins over
 * both (see `simon_thread_set_title`).
 */
export function simonSnippetTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  if (clean.length <= TITLE_SNIPPET_MAX) return clean;

  const cut = clean.slice(0, TITLE_SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(
    /[.,;:!?]+$/,
    '',
  );
  return `${base}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asCards(value: unknown): SimonListingCardRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cards = value.filter(
    (card): card is SimonListingCardRef =>
      isRecord(card) &&
      typeof card.listingId === 'string' &&
      typeof card.title === 'string',
  );
  return cards.length > 0 ? cards : undefined;
}

function asSource(value: unknown): SimonSource | undefined {
  return value === 'simon-agent' || value === 'offline-fallback'
    ? value
    : undefined;
}

/**
 * Hydrate persisted rows into render entries.
 *
 * Entry ids prefer the client-generated id the browser sent, so a thread that
 * is reloaded, edited, or regenerated keeps the same React identity for rows
 * that did not change. Older rows have no client id and fall back to the row
 * primary key.
 */
export function simonEntriesFromStoredMessages(
  messages: readonly StoredSimonMessage[],
): SimonChatEntry[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const metadata = isRecord(message.metadata) ? message.metadata : {};

    return [
      {
        id: message.client_message_id ?? message.id,
        role: message.role,
        text: message.content,
        listingCards:
          message.role === 'assistant'
            ? asCards(metadata.listingCards)
            : undefined,
        suggestedFollowUps:
          message.suggested_follow_ups && message.suggested_follow_ups.length > 0
            ? [...message.suggested_follow_ups]
            : undefined,
        source:
          message.role === 'assistant' ? asSource(metadata.source) : undefined,
        createdAt:
          message.created_at !== null && message.created_at !== undefined
            ? new Date(message.created_at)
            : undefined,
      },
    ];
  });
}

/** Metadata blob persisted alongside an assistant row. */
export function simonAssistantMetadata(entry: SimonChatEntry) {
  return {
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.listingCards ? { listingCards: entry.listingCards } : {}),
  };
}

// ---------------------------------------------------------------------------
// Deterministic memory extraction
// ---------------------------------------------------------------------------

const AREAS = [
  'spring valley',
  'lower kabete',
  'athi river',
  'kileleshwa',
  'kitisuru',
  'lavington',
  'ridgeways',
  'westlands',
  'muthaiga',
  'riverside',
  'parklands',
  'kilimani',
  'loresho',
  'muthangari',
  'thigiri',
  'rosslyn',
  'runda',
  'gigiri',
  'nyari',
  'kyuna',
  'karen',
  'syokimau',
  'mlolongo',
  'ngong',
  'rongai',
  'kiambu',
  'limuru',
  'naivasha',
  'nanyuki',
  'tigoni',
  'watamu',
  'malindi',
  'shanzu',
  'bamburi',
  'nyali',
  'diani',
  'mombasa',
  'nairobi',
  'nakuru',
  'eldoret',
  'kisumu',
] as const;

const PROPERTY_TYPES = [
  'penthouse',
  'townhouse',
  'maisonette',
  'apartment',
  'bungalow',
  'mansion',
  'duplex',
  'villa',
  'studio',
  'warehouse',
  'commercial',
  'office',
  'plot',
  'land',
] as const;

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  penthouse: 'Penthouse',
  townhouse: 'Townhouse',
  maisonette: 'Maisonette',
  apartment: 'Apartment',
  bungalow: 'Bungalow',
  mansion: 'Mansion',
  duplex: 'Duplex',
  villa: 'Villa',
  studio: 'Studio',
  warehouse: 'Warehouse',
  commercial: 'Commercial',
  office: 'Office',
  plot: 'Plot',
  land: 'Land',
};

const AMENITIES: readonly (readonly [RegExp, string])[] = [
  [/swimming\s+pool|\bpool\b/i, 'swimming pool'],
  [/\bgym(?:nasium)?\b/i, 'gym'],
  [/\bgarden\b/i, 'garden'],
  [/\bparking\b|\bcar\s*port\b/i, 'parking'],
  [/\bborehole\b/i, 'borehole'],
  [/\bsolar\b/i, 'solar'],
  [/\bcctv\b/i, 'cctv'],
  [/\bsecurity\b/i, 'security'],
  [/\blift\b|\belevator\b/i, 'lift'],
  [/\bbalcony\b/i, 'balcony'],
  [/\bterrace\b/i, 'terrace'],
  [/\bsea\s*view\b|\bocean\s*view\b/i, 'sea view'],
  [/\bcity\s*view\b/i, 'city view'],
  [/\bfurnished\b/i, 'furnished'],
  [/\bdsq\b|\bservant\s+quarters?\b/i, 'servant quarters'],
  [/\bgenerator\b/i, 'generator'],
  [/\bwater\s+tank\b/i, 'water tank'],
  [/\bjacuzzi\b/i, 'jacuzzi'],
  [/\bsauna\b/i, 'sauna'],
  [/\btennis\s+court\b/i, 'tennis court'],
  [/\bplayground\b/i, 'playground'],
];

const MONTHS =
  'january|february|march|april|may|june|july|august|september|october|november|december';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findArea(text: string): string | null {
  const lower = text.toLowerCase();
  const hit = AREAS.find((area) =>
    new RegExp(`\\b${escapeRegExp(area)}\\b`, 'i').test(lower),
  );
  if (!hit) return null;
  return hit
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function compactKes(value: number): string {
  const trim = (n: number) =>
    Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}

/** "budget 80m", "under KES 60 million", "up to 45,000,000" → "KES 80M". */
function findBudget(text: string): string | null {
  const match =
    /(?:budget(?:\s+is|\s+of)?|spend(?:ing)?(?:\s+up\s+to)?|under|below|max(?:imum)?|up\s+to|less\s+than|not\s+more\s+than|around|about)\s*(?:of\s*)?(?:kes|ksh|kshs|shs?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(million|mn|m|thousand|k)?/i.exec(
      text,
    );
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2]?.toLowerCase();
  let scaled: number;
  if (unit === 'm' || unit === 'mn' || unit === 'million') {
    scaled = amount * 1_000_000;
  } else if (unit === 'k' || unit === 'thousand') {
    scaled = amount * 1_000;
  } else if (amount < 1_000) {
    // Kenyan property chat is denominated in millions; a bare "budget 80"
    // means 80M, while "budget 85,000,000" is already absolute.
    scaled = amount * 1_000_000;
  } else {
    scaled = amount;
  }

  return `KES ${compactKes(scaled)}`;
}

function findBedrooms(text: string): string | null {
  const match = /\b(\d{1,2})\s*(?:-\s*)?(?:bed(?:room)?s?|br)\b/i.exec(text);
  return match ? match[1] : null;
}

function findTimeline(text: string): string | null {
  const patterns: readonly RegExp[] = [
    /\bas\s+soon\s+as\s+possible\b/i,
    /\bright\s+away\b/i,
    /\bimmediately\b/i,
    /\bthis\s+weekend\b/i,
    /\bnext\s+weekend\b/i,
    /\bthis\s+week\b/i,
    /\bnext\s+week\b/i,
    /\bthis\s+month\b/i,
    /\bnext\s+month\b/i,
    /\bthis\s+year\b/i,
    new RegExp(`\\bby\\s+(?:the\\s+)?(?:${MONTHS})\\b`, 'i'),
    new RegExp(`\\bin\\s+\\d{1,2}\\s+(?:weeks?|months?)\\b`, 'i'),
    /\basap\b/i,
  ];
  const hit = patterns.find((pattern) => pattern.test(text));
  if (!hit) return null;
  const value = hit.exec(text)?.[0];
  if (!value) return null;
  // Memory is read back verbatim in the editor, so sentence-case it and
  // capitalise month names instead of echoing the buyer's lowercase typing.
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`\\b(${MONTHS})\\b`, 'gi'), (month) => month[0]!.toUpperCase() + month.slice(1))
    .replace(/^./, (char) => char.toUpperCase());
}

/**
 * Pull durable buyer signals out of one user message.
 *
 * This runs on every completed turn server-side, independent of the model.
 * It is deliberately conservative: a wrong inferred budget is worse than no
 * budget, because the preamble feeds every later answer in the thread.
 */
export function extractSimonMemories(
  text: string,
): readonly SimonMemoryCandidate[] {
  const candidates: SimonMemoryCandidate[] = [];
  const budget = findBudget(text);
  if (budget) candidates.push({ kind: 'preference', key: 'budget', value: budget });

  const city = findArea(text);
  if (city) candidates.push({ kind: 'preference', key: 'city', value: city });

  const type = PROPERTY_TYPES.find((value) =>
    new RegExp(`\\b${value}s?\\b`, 'i').test(text),
  );
  if (type) {
    candidates.push({
      kind: 'preference',
      key: 'property_type',
      value: PROPERTY_TYPE_LABELS[type] ?? type,
    });
  }

  const bedrooms = findBedrooms(text);
  if (bedrooms) {
    candidates.push({ kind: 'preference', key: 'bedrooms', value: bedrooms });
  }

  const amenities = AMENITIES.filter(([pattern]) => pattern.test(text)).map(
    ([, label]) => label,
  );
  if (amenities.length > 0) {
    candidates.push({
      kind: 'preference',
      key: 'amenities',
      value: amenities.join(', '),
    });
  }

  const timeline = findTimeline(text);
  if (timeline) {
    candidates.push({ kind: 'preference', key: 'timeline', value: timeline });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Preamble
// ---------------------------------------------------------------------------

const PREAMBLE_LIMIT = 1600;

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * The invisible memory block prepended to the upstream Simon message.
 *
 * Simon's `/api/chat` accepts one message string and owns its own checkpoint
 * history, so memory has to arrive as text. The block is explicitly marked
 * private so the answer does not narrate it back; it is never rendered in the
 * UI and never persisted as a message.
 */
export function simonMemoryPreamble(input: {
  readonly memories?: readonly {
    readonly kind: 'preference' | 'fact';
    readonly key: string;
    readonly value: string;
  }[];
  readonly summary?: string | null;
  readonly summaryFacts?: readonly string[];
}): string {
  const preferences = (input.memories ?? [])
    .filter((memory) => memory.kind === 'preference')
    .slice(0, 20)
    .map((memory) => `${memory.key}=${memory.value}`);

  const durable = [
    ...(input.memories ?? [])
      .filter((memory) => memory.kind === 'fact')
      .slice(0, 20)
      .map((memory) => `${memory.key}: ${memory.value}`),
    ...(input.summaryFacts ?? []).slice(0, 12),
  ];

  const lines: string[] = [];
  if (preferences.length > 0) {
    lines.push(`Known buyer preferences: ${preferences.join('; ')}.`);
  }
  if (durable.length > 0) {
    lines.push(`Durable notes: ${durable.join('; ')}.`);
  }
  if (input.summary && input.summary.trim()) {
    lines.push(`Earlier in this conversation: ${input.summary.trim()}`);
  }
  if (lines.length === 0) return '';

  const body = clip(lines.join('\n'), PREAMBLE_LIMIT);
  return [
    '[Simon private context — do not quote, mention, or describe this block]',
    body,
    '[/Simon private context]',
    '',
  ].join('\n');
}

/** Compose the upstream message exactly once, in one place. */
export function simonRequestMessage(input: {
  readonly message: string;
  readonly preamble?: string;
}): string {
  return input.preamble ? `${input.preamble}${input.message}` : input.message;
}
