import { describe, expect, it } from "vitest";
import { assertSafeInputUrl } from "../src/utils/url-security.js";

describe("assertSafeInputUrl", () => {
  it("rejects localhost", async () => {
    await expect(assertSafeInputUrl("https://localhost/file.pdf", false)).rejects.toThrow();
  });

  it("rejects private IPv4 ranges", async () => {
    await expect(assertSafeInputUrl("https://192.168.1.5/file.pdf", false)).rejects.toThrow();
    await expect(assertSafeInputUrl("https://10.0.0.2/file.pdf", false)).rejects.toThrow();
    await expect(assertSafeInputUrl("https://169.254.169.254/latest/meta-data", false)).rejects.toThrow();
  });

  it("rejects HTTP unless enabled", async () => {
    await expect(assertSafeInputUrl("http://203.0.113.10/file.pdf", false)).rejects.toThrow("Only HTTPS");
  });
});
