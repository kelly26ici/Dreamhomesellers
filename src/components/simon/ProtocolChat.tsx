"use client";

/**
 * Full-page concierge chat, driven by the Agent Streaming Protocol.
 *
 * The distinction that matters: a turn is rendered as WORK, not as a wait.
 * Tokens arrive as Simon generates them, and each tool call he makes appears
 * as a card while it runs — so "searched 30 published listings for Karen" is
 * visible instead of a 15-second silence that reads as a dead service.
 *
 * The rate-limit notice is deliberate. Before turns streamed, an unanswered
 * 15s turn looked like failure, so users resent, and each resend burned one of
 * a 10-per-10-minute budget until they were locked out. Showing the wait gives
 * them something to do other than resend.
 */

import { useEffect, useRef, useState } from "react";
import { Search, Send, Sparkles, TriangleAlert } from "lucide-react";
import { useProtocolChat } from "@/lib/simon/use-protocol-chat";

const SUGGESTIONS = [
  "Show villas in Karen under 100 million",
  "3-bedroom apartments for rent in Westlands",
  "What is the most expensive listing?",
];

export function ProtocolChat() {
  const { messages, streaming, notice, send } = useProtocolChat();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function submit(text: string) {
    if (!text.trim()) return;
    send(text);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-6">
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              className="rounded-md border border-gold/30 px-3 py-2 text-xs text-white/80 transition-colors hover:border-gold hover:text-gold"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-5">
        {messages.map((m) => (
          <article key={m.id} className={m.role === "user" ? "self-end" : "self-start"}>
            {m.role === "user" ? (
              <p className="max-w-xl rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-white/90">
                {m.text}
              </p>
            ) : (
              <div className="max-w-xl space-y-3">
                {m.tools && m.tools.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {m.tools.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center gap-2 text-[11px] tracking-wide text-muted"
                      >
                        <Search
                          className={`h-3.5 w-3.5 ${t.status === "running" ? "animate-pulse text-gold" : "text-gold/70"}`}
                          aria-hidden
                        />
                        <span className="text-white/70">
                          {t.status === "running" ? "searching…" : "searched"}
                        </span>
                        <span className="text-muted">{t.name.replace(/_/g, " ")}</span>
                        {t.status === "running" && <span className="text-gold/70">running</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {/* The caret marks an in-flight turn, so a slow answer reads as
                    progress rather than a stall. */}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                  {m.text}
                  {streaming && m === messages[messages.length - 1] && (
                    <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-gold" />
                  )}
                </p>

                {m.error && (
                  <p className="flex items-center gap-2 text-xs text-amber-300">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    {m.error}
                  </p>
                )}
              </div>
            )}
          </article>
        ))}

        {streaming && messages.every((m) => m.role === "user") && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-gold" aria-hidden />
            Simon is searching the verified catalogue…
          </p>
        )}

        <div ref={endRef} />
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-200"
        >
          {notice.text}
          {notice.retryAfterSeconds ? (
            <span className="ml-1 text-amber-200/70">
              ({notice.retryAfterSeconds}s)
            </span>
          ) : null}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex items-center gap-2 border-t border-white/10 pt-4"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={streaming}
          placeholder={streaming ? "Simon is replying…" : "Ask about a residence, an area, a budget…"}
          aria-label="Message Simon"
          className="flex-1 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-muted focus:border-gold/50 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || !draft.trim()}
          aria-label="Send"
          className="rounded-md border border-gold/50 p-3 text-gold transition-colors hover:bg-gold/10 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export default ProtocolChat;
