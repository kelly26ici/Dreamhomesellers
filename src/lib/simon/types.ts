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

export interface SimonMessage {
  readonly id: string;
  readonly role: SimonMessageRole;
  readonly content: string;
  readonly timestamp: string;
  readonly listingCards?: readonly SimonListingCardRef[];
  readonly suggestedFollowUps?: readonly string[];
}

export interface SimonChatRequest {
  readonly message: string;
  readonly conversationId?: string;
  readonly pageContext?: Partial<PageContext>;
}

export interface SimonChatResponse {
  readonly message: SimonMessage;
  readonly conversationId: string;
}
