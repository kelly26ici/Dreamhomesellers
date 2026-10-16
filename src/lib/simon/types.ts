/**
 * Native Simon concierge types and message schemas.
 * Derived from ADR-008 and contracts.md §10.
 */

import type { PageContext } from '@/lib/contracts/page-context';

export type SimonMessageRole = 'user' | 'assistant' | 'system';

export interface SimonListingCardRef {
  readonly listingId: string;
  readonly title: string;
  readonly propertyType: string;
  readonly location: string;
  readonly priceFormatted: string;
  readonly bedrooms?: number | null;
  readonly bathrooms?: number | null;
  readonly imageUrl?: string | null;
}

/**
 * Which path produced this answer. The upstream agent and the Postgres-backed
 * keyword fallback are both real, but they are not equivalent: one reasons over
 * the catalogue, the other matches keywords against verified facts. The UI must
 * be able to say which — per message, not just once per conversation, because a
 * single thread can contain both when the agent service drops mid-session.
 */
export type SimonSource = 'simon-agent' | 'offline-fallback';

export interface SimonMessage {
  readonly id: string;
  readonly role: SimonMessageRole;
  readonly content: string;
  readonly timestamp: string;
  readonly listingCards?: readonly SimonListingCardRef[];
  readonly suggestedFollowUps?: readonly string[];
  /** Absent on hand-authored welcome messages, which are neither path. */
  readonly source?: SimonSource;
}

export interface SimonChatRequest {
  readonly message: string;
  readonly conversationId?: string;
  readonly pageContext?: Partial<PageContext>;
}

export interface SimonChatResponse {
  readonly message: SimonMessage;
  readonly conversationId: string;
  readonly source: SimonSource;
}
