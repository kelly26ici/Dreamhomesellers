"use client";

/**
 * Client for Simon's Agent Streaming Protocol.
 *
 * Consumes POST /api/simon/stream, which relays Simon's SSE verbatim. The event
 * vocabulary is the protocol's (lifecycle / messages / tools / values), so this
 * file is a reducer over that vocabulary — not a bespoke chat transport.
 *
 * Two things it does beyond parsing:
 *
 * - It distinguishes "thinking" from "done". A 15s turn used to arrive as one
 *   block of text after a silent wait, which is what made Simon look like it
 *   was not replying. Tokens land as `content-block-delta` arrives, and the
 *   tools channel gives a visible "searching…" while the agent works.
 *
 * - It reconnects from `lastEventId`. A dropped socket resumes from Simon's
 *   replay buffer instead of re-running the turn, so a flaky mobile connection
 *   does not cost a second model call.
 */

import { useCallback, useRef, useState } from "react";

export type ChatRole = "user" | "assistant";

export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  tools?: ToolActivity[];
  /** Set when the turn ended in a failure rather than an answer. */
  error?: string;
}

export interface ProtocolChatState {
  messages: ChatMessage[];
  /** A turn is in flight: tokens may still be arriving. */
  streaming: boolean;
  /** Set when the current turn cannot be started (rate limit, cold Simon). */
  notice: { kind: "rate-limited" | "error"; text: string; retryAfterSeconds?: number } | null;
  conversationId: string;
}

/**
 * A stable id for this conversation, assigned ON THE CLIENT ONLY.
 *
 * The hook's initial state is evaluated during SSR, where `crypto.randomUUID`
 * is not available, and a server/client id mismatch would be a hydration
 * error. An empty string means "not yet assigned"; the first send adopts (or
 * mints) one, so the protocol thread and the marketplace conversation share it.
 */
const UNASSIGNED = "";

function mintConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `conv_${Date.now().toString(36)}`;
}

export function useProtocolChat() {
  const [state, setState] = useState<ProtocolChatState>(() => ({
    messages: [],
    streaming: false,
    notice: null,
    conversationId: UNASSIGNED,
  }));

  // Read by the SSE loop, which outlives any single render.
  const lastEventId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const applyEvent = useCallback((event: { method: string; data: Record<string, unknown> }) => {
    setState((s) => {
      const messages = [...s.messages];
      let last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") {
        last = { id: `a_${lastEventId.current}`, role: "assistant", text: "" };
        messages.push(last);
      } else {
        last = { ...last };
        messages[messages.length - 1] = last;
      }

      if (event.method === "messages") {
        const d = event.data;
        if (d.event === "content-block-delta") {
          const delta = d.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === "text-delta") last.text += delta.text ?? "";
        }
        if (d.event === "message-finish") {
          last.id = String(d.id ?? last.id);
        }
      }

      if (event.method === "tools") {
        const tools = [...(last.tools ?? [])];
        const id = String(event.data.toolCallId ?? "");
        if (event.data.event === "tool-started") {
          tools.push({ id, name: String(event.data.name ?? "tool"), status: "running" });
        } else if (event.data.event === "tool-finished") {
          const found = tools.find((t) => t.id === id);
          if (found) found.status = "done";
        } else if (event.data.event === "tool-error") {
          const found = tools.find((t) => t.id === id);
          if (found) found.status = "failed";
        }
        last.tools = tools;
      }

      if (event.method === "lifecycle" && event.data.event === "failed") {
        last.error = String(event.data.error ?? "The concierge could not answer.");
      }

      return { ...s, messages };
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;

      setState((s) => ({
        ...s,
        messages: [...s.messages, { id: `u_${Date.now()}`, role: "user", text: trimmed }],
        streaming: true,
        notice: null,
      }));

      // Mint once and keep it: every later message must reuse this thread or
      // each turn would start a fresh conversation and forget the last.
      const conversationId = state.conversationId || mintConversationId();
      if (conversationId !== state.conversationId) {
        setState((s) => ({ ...s, conversationId }));
      }

      try {
        const res = await fetch("/api/simon/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversationId,
            lastEventId: lastEventId.current || undefined,
          }),
          signal: ac.signal,
        });

        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setState((s) => ({
            ...s,
            streaming: false,
            notice: {
              kind: "rate-limited",
              text: String(body.error ?? "The concierge is resting. Try again shortly."),
              retryAfterSeconds: body.retryAfterSeconds as number | undefined,
            },
          }));
          return;
        }

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setState((s) => ({
            ...s,
            streaming: false,
            notice: {
              kind: "error",
              text: String(body.error ?? "The concierge is unavailable right now."),
            },
          }));
          return;
        }

        // Parse SSE by hand: EventSource cannot POST, and this endpoint needs a
        // body (the message and the resume cursor).
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let split = buffer.indexOf("\n\n");
          while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);

            for (const line of frame.split("\n")) {
              if (line.startsWith("id: ")) {
                lastEventId.current = Number(line.slice(4)) || lastEventId.current;
              } else if (line.startsWith("data: ")) {
                try {
                  applyEvent(JSON.parse(line.slice(6)));
                } catch {
                  // A malformed frame is not worth killing a turn over.
                }
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }

        setState((s) => ({ ...s, streaming: false }));
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setState((s) => ({
          ...s,
          streaming: false,
          notice: { kind: "error", text: "The concierge connection dropped." },
        }));
      }
    },
    [applyEvent, state.conversationId],
  );

  return { ...state, send };
}
