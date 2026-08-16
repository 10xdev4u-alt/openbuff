import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const SAMPLE = JSON.stringify({
  default: { authToken: "91387847-6c4c-489e-a000-000000000000", email: "10xdev4u@gmail.com" },
});

describe("Freebuff credentials JSON parsing", () => {
  it("Schema.Json does NOT parse a JSON string (the old bug)", () => {
    // A raw string is itself a valid Json value, so decoding the file's text
    // against Schema.Json succeeds trivially and returns the string unchanged —
    // never an object. That is why the resolved token came back empty even
    // though the credentials file existed and was valid.
    const result = Effect.runSync(Schema.decodeUnknownEffect(Schema.Json)(SAMPLE));
    expect(typeof result).toBe("string");
  });

  it("Schema.fromJsonString(Schema.Unknown) parses the JSON string (the fix)", () => {
    const result = Effect.runSync(
      Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(SAMPLE),
    ) as { default: { authToken: string; email: string } };
    expect(typeof result).toBe("object");
    expect(result.default.authToken).toBe("91387847-6c4c-489e-a000-000000000000");
    expect(result.default.email).toBe("10xdev4u@gmail.com");
  });
});
