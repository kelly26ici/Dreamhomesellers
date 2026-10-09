"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MapPin, Phone, Mail } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const CONTACT_INFO = [
  { icon: MapPin, label: "Office", value: "One Hyde Park, London SW1X 7NA" },
  { icon: Phone, label: "Phone", value: "+44 20 7946 0958" },
  { icon: Mail, label: "Email", value: "private@luxonn.com" },
];

const FORM_FIELDS = [
  { id: "name", label: "Full Name", type: "text" },
  { id: "email", label: "Email Address", type: "email" },
  { id: "phone", label: "Phone (optional)", type: "tel" },
];

export default function Contact() {
  const rootRef = useRef<HTMLElement>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-contact='panel']",
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      id="contact"
      className="mx-auto max-w-[1440px] px-6 py-32 lg:px-12"
    >
      <div className="mb-16">
        <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
          BEGIN THE CONVERSATION
        </h2>
      </div>

      <div className="grid gap-12 lg:grid-cols-2">
        <div data-contact="panel" className="flex flex-col gap-8">
          <p className="max-w-md text-lg leading-relaxed text-muted">
            Tell us what you are looking for — or what you are ready to part
            with. An advisor responds within one business day.
          </p>

          {CONTACT_INFO.map((item) => (
            <div key={item.label} className="flex items-start gap-4">
              <item.icon className="mt-1 h-5 w-5 shrink-0 text-gold" aria-hidden />
              <div>
                <p className="text-xs tracking-[0.2em] text-muted">
                  {item.label}
                </p>
                <p className="mt-1 text-white">{item.value}</p>
              </div>
            </div>
          ))}

          <div className="group relative mt-4 h-64 overflow-hidden grayscale">
            <div className="absolute inset-0 bg-gradient-to-br from-surface-2 to-surface" />
            <div className="absolute inset-0 opacity-40 transition-all duration-700 group-hover:scale-110 group-hover:opacity-100 group-hover:grayscale-0">
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(212,169,95,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(212,169,95,0.15) 1px, transparent 1px)",
                  backgroundSize: "48px 48px",
                }}
              />
            </div>
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
              Map — One Hyde Park
            </p>
          </div>
        </div>

        <form
          data-contact="panel"
          className="glass flex flex-col gap-8 p-10"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          {FORM_FIELDS.map((field) => (
            <div key={field.id} className="relative">
              <input
                id={field.id}
                type={field.type}
                name={field.id}
                placeholder=" "
                required={field.id !== "phone"}
                className="peer w-full border-b border-white/20 bg-transparent px-0 py-3 text-white outline-none transition-colors placeholder-transparent focus:border-gold"
              />
              <label
                htmlFor={field.id}
                className="pointer-events-none absolute left-0 top-3 text-sm text-muted transition-all duration-300 peer-focus:-top-3 peer-focus:text-xs peer-focus:text-gold peer-[:not(:placeholder-shown)]:-top-3 peer-[:not(:placeholder-shown)]:text-xs"
              >
                {field.label}
              </label>
            </div>
          ))}

          <div className="relative">
            <textarea
              id="message"
              name="message"
              rows={4}
              placeholder=" "
              required
              className="peer w-full resize-none border-b border-white/20 bg-transparent px-0 py-3 text-white outline-none transition-colors placeholder-transparent focus:border-gold"
            />
            <label
              htmlFor="message"
              className="pointer-events-none absolute left-0 top-3 text-sm text-muted transition-all duration-300 peer-focus:-top-3 peer-focus:text-xs peer-focus:text-gold peer-[:not(:placeholder-shown)]:-top-3 peer-[:not(:placeholder-shown)]:text-xs"
            >
              Your Message
            </label>
          </div>

          <button
            type="submit"
            className="self-start border border-gold bg-gold px-10 py-4 text-sm tracking-[0.14em] text-black transition-all duration-300 hover:shadow-[0_0_40px_rgba(212,169,95,0.5)]"
          >
            {submitted ? "Request Sent" : "Send Inquiry"}
          </button>

          {submitted && (
            <p className="text-sm text-gold">
              Thank you. An advisor will respond within one business day.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
