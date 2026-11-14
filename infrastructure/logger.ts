import type { Environment } from "./env";

export type LogLevel = Environment["LOG_LEVEL"];
export type LogFields = Record<string, unknown>;

type LogWriter = (line: string) => void;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|database.?url|email|sentence|notification.?text)/i;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const DATABASE_URL = /\bpostgres(?:ql)?:\/\/[^\s"']+/gi;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const REDACTED = "[REDACTED]";

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(options: {
  minimumLevel?: LogLevel;
  writer?: LogWriter;
  now?: () => Date;
  deploymentVersion?: string;
  knownSecrets?: readonly string[];
} = {}): Logger {
  const minimumLevel = options.minimumLevel ?? normalizeLogLevel(process.env.LOG_LEVEL);
  const writer = options.writer ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  const deploymentVersion = options.deploymentVersion ?? process.env.DEPLOYMENT_VERSION ?? "unknown";
  const knownSecrets = (options.knownSecrets ?? collectKnownSecrets()).filter(
    (value) => value.length >= 4,
  );

  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimumLevel]) {
      return;
    }

    const record = redactValue({
      ...fields,
      timestamp: now().toISOString(),
      level,
      event,
      deploymentVersion,
    }, knownSecrets);

    writer(JSON.stringify(record));
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export const logger = createLogger();

function normalizeLogLevel(value: string | undefined): LogLevel {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

function collectKnownSecrets(): string[] {
  return [
    process.env.DATABASE_URL,
    process.env.AUTH_SECRET,
    process.env.AUTH_GOOGLE_SECRET,
  ].filter((value): value is string => Boolean(value));
}

function redactValue(value: unknown, knownSecrets: readonly string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value, knownSecrets);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      ...getSafeErrorCode(value),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, knownSecrets, seen));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redactValue(nestedValue, knownSecrets, seen);
  }
  return redacted;
}

function redactString(value: string, knownSecrets: readonly string[]): string {
  let redacted = value
    .replace(BEARER_TOKEN, REDACTED)
    .replace(DATABASE_URL, REDACTED)
    .replace(EMAIL_ADDRESS, REDACTED);

  for (const secret of knownSecrets) {
    redacted = redacted.split(secret).join(REDACTED);
  }
  return redacted;
}

function getSafeErrorCode(error: Error): { code?: string } {
  if (!("code" in error)) {
    return {};
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_-]{1,32}$/.test(code) ? { code } : {};
}
