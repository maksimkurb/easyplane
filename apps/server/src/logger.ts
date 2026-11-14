export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function emit(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> | undefined,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(options: { level?: "debug" | "info" | "warn" | "error" } = {}): Logger {
  const threshold = { debug: 10, info: 20, warn: 30, error: 40 }[options.level ?? "info"];
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const allowed = (level: "debug" | "info" | "warn" | "error"): boolean =>
    levels[level] >= threshold;
  return {
    debug: (message, fields) => allowed("debug") && emit("debug", message, fields),
    info: (message, fields) => allowed("info") && emit("info", message, fields),
    warn: (message, fields) => allowed("warn") && emit("warn", message, fields),
    error: (message, fields) => allowed("error") && emit("error", message, fields),
  };
}

export function createSilentLogger(): Logger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}
