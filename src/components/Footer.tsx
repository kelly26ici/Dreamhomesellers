import Link from "next/link";

async function CopyrightYear() {
  "use cache";
  return new Date().getFullYear();
}

/**
 * Footer navigation.
 *
 * Every link here used to be `<a href="#">` — a control that rendered a gold
 * hover state and navigated nowhere. A third-party audit found 11 of them
 * (Penthouses, Villas, Estates, New Developments, About, Advisors, Press,
 * Careers, Simon AI Assistant, Nairobi, Private Viewings), all confirmed dead
 * in the live DOM.
 *
 * This now only names destinations that exist. Verified individually:
 *   /                      the homepage
 *   /properties            catalogue; ?kind= and ?county= are real filters
 *   /gallery               the 3D collection (HTTP 200)
 *   /simon                 its own route (src/app/simon/page.tsx)
 *   /owner/listings/new    the owner listing flow
 *   /#about, /#services    real in-page anchors (About.tsx:38, Services.tsx:59)
 *
 * The old labels with no route behind them — /about, /services, /press,
 * /careers — are gone rather than pointed at a placeholder. A dead link is
 * worse than no link: it promises something and then silently does nothing,
 * which reads as a bug. When a real page ships, add it here; the COLUMNS shape
 * is unchanged, so that is one line per destination.
 *
 * `?county=Nairobi` is safe because Nairobi is a real county value (13
 * published listings, confirmed against the database) — the county filter is
 * free text matched against revision data, not a fixed enum.
 */

type FooterLink = {
  label: string;
  href: string;
};

const COLUMNS: ReadonlyArray<{
  title: string;
  links: ReadonlyArray<FooterLink>;
}> = [
  {
    title: "Explore",
    links: [
      { label: "All residences", href: "/properties" },
      { label: "For sale", href: "/properties?kind=sale" },
      { label: "For rent", href: "/properties?kind=rent" },
      { label: "The 3D collection", href: "/gallery" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About LUXONN", href: "/#about" },
      { label: "What we do", href: "/#services" },
      { label: "List your residence", href: "/owner/listings/new" },
    ],
  },
  {
    title: "Concierge",
    links: [
      { label: "Ask Simon", href: "/simon" },
      { label: "Nairobi residences", href: "/properties?county=Nairobi" },
      { label: "Book a private viewing", href: "/properties" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-6 py-20 lg:grid-cols-4 lg:px-12">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold">
              <span className="font-display text-lg leading-none text-gold">L</span>
            </span>
            <span className="font-display text-2xl tracking-widest">LUXONN</span>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-muted">
            A private collection of Kenya&rsquo;s most exceptional
            residences.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="mb-4 text-xs tracking-[0.25em] text-muted">
              {column.title}
            </p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/80 transition-colors hover:text-gold"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-white/10">
        <p className="mx-auto max-w-[1440px] px-6 py-6 text-xs text-muted lg:px-12">
          © {<CopyrightYear />} LUXONN. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
