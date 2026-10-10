import Image from "next/image";

const SHOWCASE = [
  {
    title: "Ciel Terrace",
    location: "Côte d'Azur, France",
    image:
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Marina House",
    location: "Monaco",
    image:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Summit Lodge",
    location: "Aspen, USA",
    image:
      "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Aurora Penthouse",
    location: "Oslo, Norway",
    image:
      "https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Villa Serena",
    location: "Lake Como, Italy",
    image:
      "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1600&q=80",
  },
];

export default function PropertyShowcase() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 lg:px-12">
      <div className="flex gap-6 overflow-x-auto pb-6 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]">
        <div className="w-[min(90vw,480px)] shrink-0">
          <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
            THE COLLECTION
          </h2>
          <p className="mt-6 max-w-md text-muted">
            Five residences, five statements. Keep scrolling.
          </p>
        </div>

        {SHOWCASE.map((item) => (
          <figure
            key={item.title}
            className="group relative h-[60vh] min-h-[28rem] w-[80vw] shrink-0 overflow-hidden md:w-[60vw] lg:w-[44vw]"
          >
            <Image
              src={item.image}
              alt={`${item.title}, ${item.location}`}
              fill
              sizes="(max-width: 768px) 80vw, 44vw"
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <figcaption className="absolute bottom-0 left-0 p-6">
              <p className="font-display text-3xl tracking-wide text-white">
                {item.title}
              </p>
              <p className="mt-1 text-sm text-muted">{item.location}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
