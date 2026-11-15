/**
 * Minimal SSE client for the tests (the browser uses EventSource).
 *
 * Reads a real HTTP response, parses `event:`/`data:` frames and exposes a
 * `waitFor` predicate so tests can assert on the live stream. Node's fetch
 * returns a web ReadableStream, which keeps this helper dependency-free.
 */

export interface SseFrame {
  /** SSE id field (the hub's sequence number), when present. */
  id: number | null;
  type: string;
  data: Record<string, unknown>;
}

export interface SseStream {
  status: number;
  events: SseFrame[];
  waitFor: (
    predicate: (frame: SseFrame) => boolean,
    timeoutMs?: number,
  ) => Promise<SseFrame>;
  close: () => void;
}

export async function openSseStream(
  url: string,
  options: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<SseStream> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: {
      accept: "text/event-stream",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    signal: controller.signal,
  });
  const events: SseFrame[] = [];
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    controller.abort();
    return {
      status: response.status,
      events,
      waitFor: async () => {
        throw new Error(`stream failed (${response.status}): ${body}`);
      },
      close: () => controller.abort(),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;

  const handleFrame = (frame: string) => {
    let id: number | null = null;
    let type = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("id: ")) id = Number.parseInt(line.slice(4), 10);
      else if (line.startsWith("event: ")) type = line.slice(7);
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      // Other fields (retry, comments `:`) are irrelevant for assertions.
    }
    if (dataLines.length === 0) return;
    try {
      const parsed = JSON.parse(dataLines.join("\n")) as {
        data?: Record<string, unknown>;
      };
      events.push({
        id: Number.isFinite(id) ? id : null,
        type,
        // The SSE `data:` is the whole event; expose the payload for tests.
        data: parsed.data ?? (parsed as Record<string, unknown>),
      });
    } catch {
      // Ignore malformed frames; the test will fail on its predicate.
    }
  };

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          handleFrame(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted by close().
    }
  })();

  const waitFor = async (
    predicate: (frame: SseFrame) => boolean,
    timeoutMs = 30_000,
  ): Promise<SseFrame> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(predicate);
      if (found) return found;
      if (Date.now() >= deadline) {
        throw new Error(
          `SSE condition not met within ${timeoutMs}ms; got ${JSON.stringify(
            events.map((event) => event.type),
          )}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  return {
    status: response.status,
    events,
    waitFor,
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
    },
  };
}
