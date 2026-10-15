import { NextRequest, NextResponse } from 'next/server';
import {
  fetchPublishedListing,
  fetchPublishedGrid,
} from '@/lib/marketplace/read-model';
import { formatListingPrice } from '@/lib/marketplace/format-money';
import { createAuthServerClient } from '@/lib/auth/supabase-server';
import type {
  SimonChatRequest,
  SimonMessage,
  SimonListingCardRef,
} from '@/lib/simon/types';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SimonChatRequest;
    const { message, conversationId = crypto.randomUUID(), pageContext } = body;

    if (!message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty.' },
        { status: 400 }
      );
    }

    // 1. Attempt to stream from the Python Simon FastAPI companion service if configured
    const simonApiUrl = process.env.SIMON_API_URL;
    if (simonApiUrl) {
      try {
        const upstreamRes = await fetch(`${simonApiUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            conversation_id: conversationId,
            page_context: pageContext,
          }),
          signal: AbortSignal.timeout(4000),
        });

        if (upstreamRes.ok) {
          const upstreamData = await upstreamRes.json();
          return NextResponse.json(upstreamData);
        }
      } catch {
        // Fall through to native grounded handler if upstream is unreachable
      }
    }

    // 2. Native Grounded Handler: Postgres-backed facts only (ADR-004, ADR-008)
    const normalizedMsg = message.toLowerCase();
    let replyText = '';
    let cards: SimonListingCardRef[] = [];
    let followUps: string[] = [];

    // Context 1: Active Listing Context (User is browsing a specific residence)
    if (pageContext?.active_listing_id) {
      const listingRes = await fetchPublishedListing(pageContext.active_listing_id);
      if (listingRes) {
        const { card } = listingRes;
        const price = formatListingPrice(card.priceAmount, card.priceCurrency, card.pricePeriod);

        const isOverviewQuery =
          normalizedMsg.includes('what is this') ||
          normalizedMsg.includes('what am i looking at') ||
          normalizedMsg.includes('what about this') ||
          normalizedMsg.includes('tell me about this') ||
          normalizedMsg.includes('what property is this') ||
          normalizedMsg.includes('what residence is this') ||
          normalizedMsg.includes('what is on my screen') ||
          normalizedMsg.includes('what house is this') ||
          normalizedMsg.includes('overview') ||
          normalizedMsg.includes('describe this') ||
          normalizedMsg.includes('tell me more');

        if (isOverviewQuery) {
          replyText = `You are viewing **${card.title}**, a premier ${card.propertyType} residence located in ${card.area}, ${card.city}.\n\n` +
            (card.description ? `**Architectural Profile:**\n${card.description}\n\n` : '') +
            `**Verified Specifications:**\n` +
            `• **Price:** ${price} (authoritative verified figure)\n` +
            `• **Bedrooms:** ${card.bedrooms ?? '—'}\n` +
            `• **Bathrooms:** ${card.bathrooms ?? '—'}\n` +
            `• **Interior Living:** ${card.squareMeters ? `${card.squareMeters} m²` : 'Generous dimensions'}\n` +
            `• **Lot Size:** ${card.lotSizeSqm ? `${card.lotSizeSqm} m²` : 'Private compound'}\n` +
            `• **Amenities:** ${card.amenities && card.amenities.length > 0 ? card.amenities.join(', ') : 'Standard luxury specifications'}\n\n` +
            `I am directly grounded in the verified Postgres record for this residence without needing screenshots. Would you like to schedule a viewing or explore neighborhood specifics?`;
          followUps = ['Can I schedule a viewing?', 'What amenities are included?', 'Compare with other properties'];
        } else if (normalizedMsg.includes('price') || normalizedMsg.includes('cost') || normalizedMsg.includes('how much')) {
          replyText = `**${card.title}** is currently listed at **${price}**. This is an authoritative verified figure from the LUXONN published record.`;
          followUps = ['Can I schedule a viewing?', 'What amenities are included?', 'Compare with other properties'];
        } else if (normalizedMsg.includes('bedroom') || normalizedMsg.includes('bathroom') || normalizedMsg.includes('spec') || normalizedMsg.includes('size')) {
          replyText = `**${card.title}** features ${card.bedrooms ?? '—'} bedrooms, ${card.bathrooms ?? '—'} bathrooms, and ${card.squareMeters ? `${card.squareMeters} m² of interior space` : 'generous living dimensions'}. The lot size is ${card.lotSizeSqm ? `${card.lotSizeSqm} m²` : 'specified on private inquiry'}.`;
          followUps = ['Is it furnished?', 'Are pets allowed?', 'Schedule an in-person viewing'];
        } else if (normalizedMsg.includes('amenit') || normalizedMsg.includes('pool') || normalizedMsg.includes('gym')) {
          if (card.amenities && card.amenities.length > 0) {
            replyText = `The recorded amenities for **${card.title}** include: ${card.amenities.join(', ')}.`;
          } else {
            replyText = `No special amenities have been verified in the public record for **${card.title}**. Further architectural specifications can be clarified during a viewing.`;
          }
          followUps = ['Schedule a viewing', 'Ask about the neighborhood'];
        } else if (normalizedMsg.includes('viewing') || normalizedMsg.includes('visit') || normalizedMsg.includes('tour')) {
          replyText = `I can coordinate a confidential private viewing of **${card.title}**. You can submit your preferred date and contact details in the viewing request form on this page, or let me know what day suits you best.`;
          followUps = ['Schedule for this weekend', 'Contact concierge team'];
        } else {
          replyText = `I am reviewing the verified architectural facts for **${card.title}** in ${card.area}, ${card.city}. It offers ${card.bedrooms ?? '—'} bedrooms and ${card.bathrooms ?? '—'} bathrooms, listed at ${price}.\n\nHow may I assist you with this residence?`;
          followUps = ['Tell me about the price', 'What are the amenities?', 'Arrange a viewing'];
        }

        cards = [
          {
            listingId: card.listingId,
            title: card.title,
            propertyType: card.propertyType,
            location: `${card.area}, ${card.city}`,
            priceFormatted: price,
            bedrooms: card.bedrooms,
            bathrooms: card.bathrooms,
          },
        ];
      }
    }

    // Context 2: General Catalog / Gallery / Search Context
    if (!replyText) {
      const isWhatIsThis =
        normalizedMsg.includes('what is this') ||
        normalizedMsg.includes('what am i looking at') ||
        normalizedMsg.includes('what is on my screen');

      if (pageContext?.route?.startsWith('/gallery') || pageContext?.view_mode === 'curated') {
        if (isWhatIsThis) {
          replyText = `You are viewing the LUXONN Signature 3D Collection at \`/gallery\`. This is an interactive architectural showcase featuring Kenya's landmark luxury residences, including Karen standalone villas and Westlands penthouses. You can click any residence in the gallery to inspect its complete verified specifications.`;
          followUps = ['Show residences in Karen', 'Explore Nairobi catalog', 'Book a private tour'];
        }
      } else if (pageContext?.route?.startsWith('/properties') || pageContext?.view_mode === 'search') {
        if (isWhatIsThis) {
          const filterDesc = pageContext?.search_filters?.city ? ` in ${pageContext.search_filters.city}` : '';
          const grid = await fetchPublishedGrid({ page: 1, sort: 'newest' });
          const matches = grid.cards.slice(0, 3);
          replyText = `You are browsing the LUXONN Kenya luxury catalog${filterDesc}. There are currently ${grid.total} published residences on the platform. Here are premier options currently featured:`;
          cards = matches.map((c) => ({
            listingId: c.listingId,
            title: c.title,
            propertyType: c.propertyType,
            location: `${c.area}, ${c.city}`,
            priceFormatted: formatListingPrice(c.priceAmount, c.priceCurrency, c.pricePeriod),
            bedrooms: c.bedrooms,
            bathrooms: c.bathrooms,
          }));
          followUps = ['Show villas in Karen', 'Filter below 100m KES', 'Compare top residences'];
        }
      }

      // Context 3: Keyword search / Default fallback
      if (!replyText) {
        if (
          normalizedMsg.includes('karen') ||
          normalizedMsg.includes('westlands') ||
          normalizedMsg.includes('penthouse') ||
          normalizedMsg.includes('villa') ||
          normalizedMsg.includes('bedroom') ||
          normalizedMsg.includes('find') ||
          normalizedMsg.includes('show')
        ) {
          const grid = await fetchPublishedGrid({ page: 1, sort: 'newest' });
          const matches = grid.cards.slice(0, 3);

          replyText = `I found ${grid.total} published residences in the LUXONN Kenya collection. Here are premier options matching current verified inventory:`;
          cards = matches.map((c) => ({
            listingId: c.listingId,
            title: c.title,
            propertyType: c.propertyType,
            location: `${c.area}, ${c.city}`,
            priceFormatted: formatListingPrice(c.priceAmount, c.priceCurrency, c.pricePeriod),
            bedrooms: c.bedrooms,
            bathrooms: c.bathrooms,
          }));
          followUps = ['Show villas in Karen', 'Filter below 100m KES', 'Compare top residences'];
        } else {
          replyText = `Welcome to LUXONN. I am Simon, your private property concierge. I can provide grounded facts about verified Kenyan residences, compare architectural specifications, and arrange confidential viewings without requiring screenshots or external lookups.\n\nWhat kind of home or location are you exploring today?`;
          followUps = ['Show residences in Karen', 'Explore luxury penthouses in Nairobi', 'View the 3D gallery'];
        }
      }
    }

    const assistantMsg: SimonMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: replyText,
      timestamp: new Date().toISOString(),
      listingCards: cards.length > 0 ? cards : undefined,
      suggestedFollowUps: followUps.length > 0 ? followUps : undefined,
    };

    // Persist conversation turn into Postgres
    try {
      const supabase = await createAuthServerClient();
      await supabase.rpc('save_conversation_turn', {
        p_thread_id: conversationId,
        p_session_id: conversationId,
        p_user_content: message,
        p_assistant_content: replyText,
        p_page_context: pageContext || {},
        p_referenced_listing_ids: cards.map((c) => c.listingId),
        p_suggested_follow_ups: followUps,
      });
    } catch (persistErr) {
      console.warn('Failed to persist conversation turn:', persistErr);
    }

    return NextResponse.json({
      message: assistantMsg,
      conversationId,
    });
  } catch (error) {
    console.error('Simon chat endpoint error:', error);
    return NextResponse.json(
      { error: 'An unexpected concierge processing error occurred.' },
      { status: 500 }
    );
  }
}
