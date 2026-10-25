"use client";

/**
 * Streaming transport for Simon's Agent Streaming Protocol.
 *
 * Replaces the single-shot JSON fetch in NativeSimonChat with an SSE stream
 * that delivers tokens as they arrive. Falls back to /api/simon/chat when the
 * stream cannot be opened, so the offline keyword matcher still works.
 *
 * Returns the same SimonMessage shape NativeSimonChat already renders, plus
 * a ToolActivity[] for each in-flight turn so the UI can show "searching…"
 * cards while Simon works.
 */

import { useCallback, useRef, useState } from "react";
import type { SimonMessage, SimonSource } from "@/lib/simon/types";
import type { PageContext } from "@/lib/contracts/page-context";

export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
}

export interface StreamTurnState {
  tools: ToolActivity[];
  partialText: string;
  streaming: boolean;
}

interface UseSimonStreamReturn {
  turn: StreamTurnState;
  send: (
    text: string,
    opts: {
      conversationId: string;
      pageContext?: Partial<PageContext>;
    },
  ) => Promise<SimonMessage | null>;
  abort: () => void;
  notice: { kind: "rate-limited" | "error"; text: string; retryAfterSeconds?: number } | null;
}

export function useSimonStream(): UseSimonStreamReturn {
  const [turn, setTurn] = useState<StreamTurnState>({
    tools: [],
    partialText: "",
    streaming: false,
  });
  const [notice, setNotice] = useState<UseSimonStreamReturn["notice"]>(null);

  const lastEventId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const send = useCallback(
    async (
      text: string,
      opts: { conversationId: string; pageContext?: Partial<PageContext> },
    ): Promise<SimonMessage | null> => {
      abort();
      const ac = new AbortController();
      controllerRef.current = ac;

      setTurn({ tools: [], partialText: "", streaming: true });
      setNotice(null);

      let accumulated = "";
      const tools: ToolActivity[] = [];
      let messageId = `a_${Date.now()}`;

      try {
        const res = await fetch("/api/simon/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId: opts.conversationId,
            pageContext: opts.pageContext,
            lastEventId: lastEventId.current || undefined,
          }),
          signal: ac.signal,
        });

        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setNotice({
            kind: "rate-limited",
            text: String(body.error ?? "The concierge is resting. Try again shortly."),
            retryAfterSeconds: body.retryAfterSeconds as number | undefined,
          });
          setTurn((s) => ({ ...s, streaming: false }));
          return null;
        }

        if (!res.ok || !res.body) {
          return await jsonFallback(text, opts);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let cut = buffer.indexOf("\n");
          while (cut !== -1) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 1);

            if (line.startsWith("id: ")) {
              lastEventId.current = Number(line.slice(4)) || lastEventId.current;
            } else if (line.startsWith("data: ")) {
              try {
                const envelope = JSON.parse(line.slice(6)) as {
                  method?: string;
                  params?: { data?: unknown } | null;
                };
                const method = String(envelope.method ?? "");
                const data = ((envelope.params?.data) ?? {}) as Record<string, unknown>;

                if (method === "messages") {
                  if (data.event === "content-block-delta") {
                    const delta = data.delta as { type?: string; text?: string } | undefined;
                    if (delta?.type === "text-delta" && delta.text) {
                      accumulated += delta.text;
                      setTurn((s) => ({ ...s, partialText: accumulated }));
                    }
                  }
                  if (data.event === "message-finish") {
                    messageId = String(data.id ?? messageId);
                  }
                }

                if (method === "tools") {
                  const toolId = String(data.toolCallId ?? "");
                  if (data.event === "tool-started") {
                    tools.push({ id: toolId, name: String(data.name ?? "tool"), status: "running" });
                    setTurn((s) => ({ ...s, tools: [...tools] }));
                  } else if (data.event === "tool-finished") {
                    const found = tools.find((t) => t.id === toolId);
                    if (found) found.status = "done";
                    setTurn((s) => ({ ...s, tools: [...tools] }));
                  } else if (data.event === "tool-error") {
                    const found = tools.find((t) => t.id === toolId);
                    if (found) found.status = "failed";
                    setTurn((s) => ({ ...s, tools: [...tools] }));
                  }
                }

                if (method === "lifecycle" && data.event === "failed") {
                  setNotice({
                    kind: "error",
                    text: String(data.error ?? "The concierge could not answer."),
                  });
                }
              } catch {
                // Malformed SSE frame — skip
              }
            }

            cut = buffer.indexOf("\n");
          }
        }

        setTurn((s) => ({ ...s, streaming: false }));

        if (!accumulated) return null;

        return {
          id: messageId,
          role: "assistant",
          content: accumulated,
          timestamp: new Date().toISOString(),
          source: "simon-agent" as SimonSource,
        };
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setTurn((s) => ({ ...s, streaming: false }));
          return null;
        }
        return await jsonFallback(text, opts);
      }
    },
    [abort],
  );

  async function jsonFallback(
    text: string,
    opts: { conversationId: string; pageContext?: Partial<PageContext> },
  ): Promise<SimonMessage | null> {
    try {
      const res = await fetch("/api/simon/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: opts.conversationId,
          pageContext: opts.pageContext,
        }),
      });

      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setNotice({
          kind: "rate-limited",
          text: String(body.error ?? "The concierge is resting. Try again shortly."),
          retryAfterSeconds: body.retryAfterSeconds as number | undefined,
        });
        setTurn((s) => ({ ...s, streaming: false }));
        return null;
      }

      if (!res.ok) {
        setNotice({ kind: "error", text: "The concierge is unavailable right now." });
        setTurn((s) => ({ ...s, streaming: false }));
        return null;
      }

      const data = await res.json();
      setTurn((s) => ({ ...s, streaming: false }));

      if (data.source === "offline-fallback") {
        setNotice({
          kind: "error",
          text: "Simon’s AI concierge is temporarily offline — you’re getting basic verified-fact answers only.",
        });
      }

      if (data.message) return data.message as SimonMessage;
      return null;
    } catch {
      setNotice({ kind: "error", text: "The concierge connection dropped." });
      setTurn((s) => ({ ...s, streaming: false }));
      return null;
    }
  }

  return { turn, send, abort, notice };
}
