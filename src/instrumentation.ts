/**
 * The website's half of the cross-ping keep-alive.
 *
 * Render spins a free web service down after ~15 minutes with no **inbound**
 * requests. A background loop inside a service makes *outbound* requests, which
 * does not count — a service cannot keep itself warm. So each service pings the
 * *other* one: this loop gives Simon inbound traffic, Simon's loop
 * (`src/simon/keepalive.py` in the companion repo) gives this service inbound
 * traffic, and a single visit to either URL makes the pair self-sustaining.
 *
 * The one case this cannot fix: if BOTH services are cold simultaneously,
 * neither loop is running to wake the other. That needs an external monitor or
 * a paid plan, and is a decision recorded in the rebuild plan.
 *
 * `register()` runs once per server process at startup on Render, which is the
 * natural place for a long-lived loop in a Node server. Uses built-in fetch, so
 * no dependency is added.
 *
 * With SIMON_API_URL unset (local dev, or any deploy that has not configured
 * it) this does nothing at all — no timer, no log noise.
 */

const INTERVAL_MS = 300_000; // 5 minutes, matching Simon's cadence
const HEALTH_PATH = "/api/health";
const PING_TIMEOUT_MS = 120_000; // a cold free-tier service can take ~90s

function target(): string | null {
  const url = process.env.SIMON_API_URL;
  if (!url) return null;
  return `${url.replace(/\/+$/, "")}${HEALTH_PATH}`;
}

async function ping(url: string): Promise<void> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`keep-alive: ${url} returned HTTP ${response.status}`);
    }
  } catch (error) {
    // A failed ping is not worth crashing a boot over; the next cycle retries.
    console.warn("keep-alive: ping to Simon failed", error);
  }
}

export async function register(): Promise<void> {
  const url = target();
  if (!url) {
    // Logged, not silent: whether the loop is disabled is the single most
    // useful line in the deploy log when someone asks why a service was cold.
    console.info("keep-alive disabled: SIMON_API_URL is not set");
    return;
  }

  // Ping immediately so a freshly deployed pair warms up at once rather than
  // waiting a full interval, then on the interval.
  console.info(`keep-alive: pinging ${url} every ${INTERVAL_MS / 1000}s`);
  await ping(url);
  setInterval(() => void ping(url), INTERVAL_MS).unref();
  // .unref() lets the process exit cleanly when Render stops it, instead of
  // the timer holding the event loop open.
}
