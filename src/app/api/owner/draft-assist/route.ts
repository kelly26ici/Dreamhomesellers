import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/auth/supabase-server';

export interface AIDraftRequest {
  notes: string;
  listingKind?: 'sale' | 'rent' | 'shortlet';
  propertyType?: string;
  areaHint?: string;
}

export interface AIDraftResponse {
  title: string;
  description: string;
  propertyType: string;
  propertySubtype?: string;
  priceAmount: string;
  priceCurrency: string;
  pricePeriod: 'one_time' | 'per_month' | 'per_night';
  bedrooms?: string;
  bathrooms?: string;
  squareMeters?: string;
  lotSizeSqm?: string;
  area: string;
  city: string;
  country: string;
  amenities: string[];
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify caller is authenticated owner
    const supabase = await createAuthServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'You must be signed in to use the AI drafting assistant.' },
        { status: 401 }
      );
    }

    const body = (await req.json()) as AIDraftRequest;
    const { notes, listingKind = 'sale', propertyType, areaHint } = body;

    if (!notes || notes.trim().length < 5) {
      return NextResponse.json(
        { error: 'Please provide at least a few details or rough notes about the property.' },
        { status: 400 }
      );
    }

    // 2. If external Python Simon agent is configured, try upstream first
    const simonApiUrl = process.env.SIMON_API_URL;
    if (simonApiUrl) {
      try {
        const upstream = await fetch(`${simonApiUrl}/api/owner/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes, listing_kind: listingKind, user_id: user.id }),
          signal: AbortSignal.timeout(4000),
        });
        if (upstream.ok) {
          const data = (await upstream.json()) as AIDraftResponse;
          return NextResponse.json({ draft: data });
        }
      } catch {
        // Fall back to native deterministic luxury synthesis engine
      }
    }

    // 3. Native deterministic luxury drafting synthesis engine
    const draft = synthesizeLuxuryDraft(notes, listingKind, propertyType, areaHint);

    return NextResponse.json({ draft });
  } catch (error) {
    console.error('AI draft assistant error:', error);
    return NextResponse.json(
      { error: 'Failed to generate listing draft proposal.' },
      { status: 500 }
    );
  }
}

function synthesizeLuxuryDraft(
  notes: string,
  listingKind: 'sale' | 'rent' | 'shortlet',
  propTypeHint?: string,
  areaHint?: string
): AIDraftResponse {
  const lower = notes.toLowerCase();

  // Detect Area
  let area = 'Karen';
  let city = 'Nairobi';
  const areas = [
    { name: 'Karen', city: 'Nairobi', keywords: ['karen'] },
    { name: 'Runda', city: 'Nairobi', keywords: ['runda'] },
    { name: 'Muthaiga', city: 'Nairobi', keywords: ['muthaiga'] },
    { name: 'Westlands', city: 'Nairobi', keywords: ['westlands', 'rhapta', 'sarit'] },
    { name: 'Lavington', city: 'Nairobi', keywords: ['lavington'] },
    { name: 'Kilimani', city: 'Nairobi', keywords: ['kilimani', 'yaya', 'argwings'] },
    { name: 'Kileleshwa', city: 'Nairobi', keywords: ['kileleshwa'] },
    { name: 'Kiambu Road', city: 'Nairobi', keywords: ['kiambu road', 'paradise lost', 'fourways'] },
    { name: 'Nyali', city: 'Mombasa', keywords: ['nyali', 'mombasa'] },
    { name: 'Diani', city: 'Kwale', keywords: ['diani', 'galu', 'kwale'] },
    { name: 'Naivasha', city: 'Naivasha', keywords: ['naivasha', 'lake'] },
    { name: 'Utawala', city: 'Nairobi', keywords: ['utawala', 'kangundo'] },
    { name: 'Joska', city: 'Machakos', keywords: ['joska', 'kantafu'] },
  ];

  for (const a of areas) {
    if (a.keywords.some((k) => lower.includes(k))) {
      area = a.name;
      city = a.city;
      break;
    }
  }
  if (areaHint && areaHint.trim()) {
    area = areaHint.trim();
  }

  // Detect Property Type
  let detectedType = propTypeHint || 'villa';
  if (lower.includes('apartment') || lower.includes('flat')) detectedType = 'apartment';
  else if (lower.includes('penthouse')) detectedType = 'penthouse';
  else if (lower.includes('townhouse') || lower.includes('maisonette')) detectedType = 'townhouse';
  else if (lower.includes('land') || lower.includes('plot') || lower.includes('acre')) {
    if (!lower.includes('house') && !lower.includes('villa')) detectedType = 'land';
  } else if (lower.includes('villa')) detectedType = 'villa';
  else if (lower.includes('house') || lower.includes('bungalow')) detectedType = 'house';

  // Detect Bedrooms
  let beds = '4';
  const bedMatch = lower.match(/(\d+)\s*[-]?\s*(?:bed|bedroom|br|bdr)/);
  if (bedMatch) beds = bedMatch[1];

  // Detect Bathrooms
  let baths = beds;
  const bathMatch = lower.match(/(\d+)\s*[-]?\s*(?:bath|bathroom|btr)/);
  if (bathMatch) baths = bathMatch[1];

  // Detect Price
  let price = '95000000';
  let period: 'one_time' | 'per_month' | 'per_night' =
    listingKind === 'rent' ? 'per_month' : listingKind === 'shortlet' ? 'per_night' : 'one_time';

  const priceMatchM = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|million|m\b)/);
  const priceMatchK = lower.match(/(\d+(?:\.\d+)?)\s*(?:k|thousand)/);
  const rawNumMatch = lower.match(/(?:kes|ksh|price|asking|cost|for)\s*[:=]?\s*(\d[\d,]+)/);

  if (priceMatchM) {
    const millions = parseFloat(priceMatchM[1]);
    price = (millions * 1000000).toString();
  } else if (priceMatchK) {
    const thousands = parseFloat(priceMatchK[1]);
    price = (thousands * 1000).toString();
  } else if (rawNumMatch) {
    price = rawNumMatch[1].replace(/,/g, '');
  } else {
    if (listingKind === 'rent') price = '250000';
    else if (listingKind === 'shortlet') price = '18000';
  }

  // Detect Sqm / Lot size
  let sqmMeters = '';
  const sqmMatch = lower.match(/(\d+)\s*(?:sqm|sq\s*m|square\s*meters)/);
  if (sqmMatch) sqmMeters = sqmMatch[1];

  let lotSize = '';
  if (lower.includes('half an acre') || lower.includes('0.5 acre') || lower.includes('1/2 acre')) {
    lotSize = '2023';
  } else if (lower.includes('1 acre') || lower.includes('one acre')) {
    lotSize = '4046';
  } else if (lower.includes('quarter acre') || lower.includes('0.25 acre') || lower.includes('1/4 acre')) {
    lotSize = '1011';
  } else if (lower.includes('1/8') || lower.includes('eighth')) {
    lotSize = '506';
  }

  // Detect Amenities
  const candidateAmenities: Array<{ name: string; triggers: string[] }> = [
    { name: 'private swimming pool', triggers: ['pool', 'swimming pool', 'plunge'] },
    { name: 'borehole', triggers: ['borehole', 'well'] },
    { name: 'solar backup', triggers: ['solar', 'inverter', 'green energy'] },
    { name: 'backup generator', triggers: ['generator', 'full backup power'] },
    { name: 'staff quarters', triggers: ['dsq', 'staff', 'domestic servant'] },
    { name: '24-hour security', triggers: ['security', 'guard', 'cctv', 'gated'] },
    { name: 'private landscaped garden', triggers: ['garden', 'lawn', 'mature trees'] },
    { name: 'fireplace', triggers: ['fireplace', 'hearth'] },
    { name: 'high ceilings', triggers: ['high ceiling', 'double volume', 'void'] },
    { name: 'panoramic balcony', triggers: ['balcony', 'terrace', 'view', 'views'] },
    { name: 'modern fitted kitchen', triggers: ['kitchen', 'island', 'pantry'] },
    { name: 'secure garage', triggers: ['garage', 'parking', 'carport'] },
  ];

  const amenities: string[] = [];
  for (const cand of candidateAmenities) {
    if (cand.triggers.some((t) => lower.includes(t))) {
      amenities.push(cand.name);
    }
  }
  if (amenities.length === 0) {
    amenities.push('24-hour security', 'borehole', 'private landscaped garden');
  }

  // Craft Title (Editorial LUXONN Style)
  const capitalizedType = detectedType.charAt(0).toUpperCase() + detectedType.slice(1);
  let title = `${area} — ${beds}-Bedroom Architectural ${capitalizedType}`;
  if (lotSize === '2023') title += ' on Half an Acre';
  else if (lotSize === '4046') title += ' on One Acre';
  else if (detectedType === 'penthouse') title = `${area} — Signature ${beds}-Bedroom Penthouse with Panoramic Views`;

  // Craft Description (Evocative Luxury Architectural Prose)
  const description = [
    `Situated within the prestigious residential enclaves of ${area}, this exceptional ${beds}-bedroom residence embodies refined Kenyan luxury and contemporary architectural mastery.`,
    `Thoughtfully crafted to harmonize indoor spatial drama with serene natural surrounds, the home features expansive living pavilions, high double-volume ceilings, and seamless transitions to private outdoor entertaining spaces.`,
    `Key residence specifications include:\n- ${beds} generous en-suite sanctuaries with custom cabinetry\n- ${amenities.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join('\n- ')}\n- Secure boundary enclosure and reliable water/power infrastructure.`,
    `An extraordinary opportunity for discerning private clients seeking an enduring sanctuary in one of ${city}'s premier architectural locations.`,
  ].join('\n\n');

  return {
    title,
    description,
    propertyType: detectedType,
    propertySubtype: detectedType === 'penthouse' ? 'duplex' : undefined,
    priceAmount: price,
    priceCurrency: 'KES',
    pricePeriod: period,
    bedrooms: detectedType === 'land' ? undefined : beds,
    bathrooms: detectedType === 'land' ? undefined : baths,
    squareMeters: sqmMeters || undefined,
    lotSizeSqm: lotSize || undefined,
    area,
    city,
    country: 'Kenya',
    amenities,
  };
}
