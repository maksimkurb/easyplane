import { describe, expect, it } from "vitest";

import {
  DEVICE_DESCRIPTION_MAX_LENGTH,
  isDeviceDescriptionLengthValid,
  normalizeDeviceDescription,
} from "@easyplane/server";

describe("device description", () => {
  it("trims the edges and keeps inner spacing", () => {
    expect(normalizeDeviceDescription("  Роутер в гараже  ")).toBe(
      "Роутер в гараже",
    );
  });

  it("collapses newlines and repeated whitespace into one paragraph", () => {
    expect(normalizeDeviceDescription("Дача,\nOpenWrt\n\n  за шкафом")).toBe(
      "Дача, OpenWrt за шкафом",
    );
  });

  it("stores blank input as null", () => {
    expect(normalizeDeviceDescription("")).toBeNull();
    expect(normalizeDeviceDescription(" \n\t ")).toBeNull();
    expect(normalizeDeviceDescription(null)).toBeNull();
    expect(normalizeDeviceDescription(undefined)).toBeNull();
  });

  it("accepts exactly the 280-character limit and rejects one more", () => {
    const atLimit = "я".repeat(DEVICE_DESCRIPTION_MAX_LENGTH);
    expect(isDeviceDescriptionLengthValid(atLimit)).toBe(true);
    expect(
      isDeviceDescriptionLengthValid(`${atLimit}я`),
    ).toBe(false);
  });

  it("measures the normalized text, not padding", () => {
    const description = normalizeDeviceDescription(
      `  ${"я".repeat(DEVICE_DESCRIPTION_MAX_LENGTH)}  `,
    );
    expect(description).not.toBeNull();
    expect(isDeviceDescriptionLengthValid(description!)).toBe(true);
  });
});
