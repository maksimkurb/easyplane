/**
 * HuJSON (human JSON) reader: JSON with `//`, `#` and block comments plus
 * trailing commas. Tailscale's policy file uses this dialect; the panel's
 * advanced editor accepts it too so operators can paste a Tailscale ACL with
 * comments.
 *
 * This is a small hand-written parser instead of a regex strip because comments
 * may appear inside strings and errors must point at a line/column.
 */

export class HuJsonError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "HuJsonError";
  }
}

type Token =
  | { kind: "punct"; value: "{" | "}" | "[" | "]" | ":" | "," }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "literal"; value: true | false | null }
  | { kind: "eof" };

class Reader {
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  private peek(offset = 0): string {
    return this.source[this.index + offset] ?? "";
  }

  private advance(): string {
    const char = this.source[this.index++] ?? "";
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  private error(message: string): never {
    throw new HuJsonError(message, this.line, this.column);
  }

  /** Skips whitespace and comments. */
  private skipTrivia(): void {
    for (;;) {
      const char = this.peek();
      if (char === " " || char === "\t" || char === "\r" || char === "\n") {
        this.advance();
        continue;
      }
      if (char === "/" && this.peek(1) === "/") {
        while (this.peek() !== "" && this.peek() !== "\n") this.advance();
        continue;
      }
      if (char === "#") {
        while (this.peek() !== "" && this.peek() !== "\n") this.advance();
        continue;
      }
      if (char === "/" && this.peek(1) === "*") {
        this.advance();
        this.advance();
        while (this.peek() !== "" && !(this.peek() === "*" && this.peek(1) === "/")) {
          this.advance();
        }
        if (this.peek() === "") this.error("unterminated block comment");
        this.advance();
        this.advance();
        continue;
      }
      return;
    }
  }

  next(): Token {
    this.skipTrivia();
    const char = this.peek();
    if (char === "") return { kind: "eof" };
    if ("{}[]:,".includes(char)) {
      this.advance();
      return { kind: "punct", value: char as "{" | "}" | "[" | "]" | ":" | "," };
    }
    if (char === '"') return { kind: "string", value: this.readString() };
    if (char === "-" || (char >= "0" && char <= "9")) {
      return { kind: "number", value: this.readNumber() };
    }
    if (this.source.startsWith("true", this.index)) {
      this.advance();
      this.advance();
      this.advance();
      this.advance();
      return { kind: "literal", value: true };
    }
    if (this.source.startsWith("false", this.index)) {
      for (let i = 0; i < 5; i += 1) this.advance();
      return { kind: "literal", value: false };
    }
    if (this.source.startsWith("null", this.index)) {
      for (let i = 0; i < 4; i += 1) this.advance();
      return { kind: "literal", value: null };
    }
    this.error(`unexpected character "${char}"`);
  }

  private readString(): string {
    this.advance(); // opening quote
    let result = "";
    for (;;) {
      const char = this.peek();
      if (char === "") this.error("unterminated string");
      if (char === '"') {
        this.advance();
        return result;
      }
      if (char === "\\") {
        this.advance();
        const escape = this.advance();
        switch (escape) {
          case '"':
          case "\\":
          case "/":
            result += escape;
            break;
          case "b":
            result += "\b";
            break;
          case "f":
            result += "\f";
            break;
          case "n":
            result += "\n";
            break;
          case "r":
            result += "\r";
            break;
          case "t":
            result += "\t";
            break;
          case "u": {
            const hex = this.source.slice(this.index, this.index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error("invalid \\u escape");
            result += String.fromCharCode(Number.parseInt(hex, 16));
            for (let i = 0; i < 4; i += 1) this.advance();
            break;
          }
          default:
            this.error(`invalid escape "\\${escape}"`);
        }
        continue;
      }
      // Raw control characters are not allowed in JSON strings.
      if (char.charCodeAt(0) < 0x20) this.error("control character in string");
      result += this.advance();
    }
  }

  private readNumber(): number {
    const start = this.index;
    if (this.peek() === "-") this.advance();
    while (/[0-9]/.test(this.peek())) this.advance();
    if (this.peek() === ".") {
      this.advance();
      if (!/[0-9]/.test(this.peek())) this.error("invalid number");
      while (/[0-9]/.test(this.peek())) this.advance();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") this.advance();
      if (!/[0-9]/.test(this.peek())) this.error("invalid number");
      while (/[0-9]/.test(this.peek())) this.advance();
    }
    const text = this.source.slice(start, this.index);
    const value = Number(text);
    if (!Number.isFinite(value)) this.error(`invalid number "${text}"`);
    return value;
  }

  /** Reads one JSON value; the parser is here so recursion has one entry. */
  readValue(): unknown {
    const token = this.next();
    if (token.kind === "string") return token.value;
    if (token.kind === "number") return token.value;
    if (token.kind === "literal") return token.value;
    if (token.kind === "punct" && token.value === "{") {
      const object: Record<string, unknown> = {};
      for (;;) {
        this.skipTrivia();
        if (this.peek() === "}") {
          this.advance();
          return object;
        }
        const keyToken = this.next();
        if (keyToken.kind !== "string") this.error("object key must be a string");
        const colon = this.next();
        if (!(colon.kind === "punct" && colon.value === ":")) {
          this.error('expected ":" after object key');
        }
        object[keyToken.value] = this.readValue();
        this.skipTrivia();
        if (this.peek() === ",") {
          this.advance();
          continue;
        }
        if (this.peek() === "}") {
          this.advance();
          return object;
        }
        this.error('expected "," or "}" in object');
      }
    }
    if (token.kind === "punct" && token.value === "[") {
      const array: unknown[] = [];
      for (;;) {
        this.skipTrivia();
        if (this.peek() === "]") {
          this.advance();
          return array;
        }
        array.push(this.readValue());
        this.skipTrivia();
        if (this.peek() === ",") {
          this.advance();
          continue;
        }
        if (this.peek() === "]") {
          this.advance();
          return array;
        }
        this.error('expected "," or "]" in array');
      }
    }
    this.error("expected a JSON value");
  }

  atEnd(): boolean {
    this.skipTrivia();
    return this.peek() === "";
  }
}

/** Parses HuJSON text into a plain JavaScript value. */
export function parseHuJson(source: string): unknown {
  if (source.length > 1_000_000) {
    throw new HuJsonError("document is too large (1 MB limit)", 1, 1);
  }
  const reader = new Reader(source);
  const value = reader.readValue();
  if (!reader.atEnd()) {
    throw new HuJsonError("unexpected trailing content", 1, 1);
  }
  return value;
}
