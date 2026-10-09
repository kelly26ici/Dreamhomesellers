async function CopyrightYear() {
  "use cache";
  return new Date().getFullYear();
}

const COLUMNS = [
  {
    title: "Properties",
    links: ["Penthouses", "Villas", "Estates", "New Developments"],
  },
  {
    title: "Company",
    links: ["About", "Advisors", "Press", "Careers"],
  },
  {
    title: "Contact",
    links: ["private@luxonn.com", "+44 20 7 946 0958", "One Hyde Park, London"],
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
            A private collection of the world&rsquo;s most exceptional
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
                <li key={link}>
                  <a
                    href="#"
                    className="text-sm text-white/80 transition-colors hover:text-gold"
                  >
                    {link}
                  </a>
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
