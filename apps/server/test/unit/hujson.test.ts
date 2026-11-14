import { describe, expect, it } from "vitest";

import {
  HuJsonError,
  parseHuJson,
  parsePolicyText,
  splitDestination,
} from "@easyplane/server";

describe("HuJSON reader", () => {
  it("accepts line, hash and block comments and trailing commas", () => {
    const value = parseHuJson(`{
      // a line comment
      "a": 1, # a hash comment
      "b": [1, 2, 3,],
      /* block
         comment */
      "c": "text // not a comment /* here */",
    }`);
    expect(value).toEqual({ a: 1, b: [1, 2, 3], c: "text // not a comment /* here */" });
  });

  it("keeps escaped characters and unicode escapes", () => {
    expect(parseHuJson('{"a":"line\\nquote\\"slash\\\\","b":"\\u00e9"}')).toEqual({
      a: 'line\nquote"slash\\',
      b: "é",
    });
  });

  it("reports the line and column of a syntax error", () => {
    try {
      parseHuJson(`{
        "a": 1
        "b": 2
      }`);
      throw new Error("expected a parse error");
    } catch (error) {
      expect(error).toBeInstanceOf(HuJsonError);
      expect((error as HuJsonError).line).toBe(3);
    }
  });

  it("rejects trailing content and unterminated strings", () => {
    expect(() => parseHuJson("{} {}")).toThrow(HuJsonError);
    expect(() => parseHuJson('{"a": "x}')).toThrow(/unterminated string/);
  });

  it("parses a policy document with comments end to end", () => {
    const document = parsePolicyText(`{
      // Who may reach the database
      "tagOwners": { "tag:db": ["group:ops"] },
      "acls": [
        { "name": "web-db", "action": "accept",
          "src": ["tag:web"], "dst": ["tag:db:5432"], "proto": "tcp" },
      ],
    }`);
    expect(document.acls).toHaveLength(1);
    expect(document.acls[0]?.name).toBe("web-db");
  });
});

describe("destination parsing", () => {
  it("separates subject and ports without confusing IPv4 colons", () => {
    expect(splitDestination("tag:web:80,443")).toEqual({
      subject: "tag:web",
      ports: "80,443",
      explicitPorts: true,
    });
    expect(splitDestination("cidr:10.0.0.0/24:443").subject).toBe("cidr:10.0.0.0/24");
    expect(splitDestination("tag:web").ports).toBe("*");
    expect(splitDestination("device:db1:5432:6543").subject).toBe("device:db1:5432");
  });
});
