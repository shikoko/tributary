import { describe, expect, it } from "vitest";
import { describeSignature } from "./signatures";

describe("describeSignature", () => {
  it("verifies good signatures and flags bad ones", () => {
    const good = describeSignature({ status: "good", kind: "gpg", signer: "Maya Chen <maya@example.com>", key: "A5EAD03C" });
    expect(good).toEqual({ label: "Verified", tone: "good", detail: "Signed by Maya Chen <maya@example.com> (GPG key A5EAD03C), and the signature checks out." });
    expect(describeSignature({ status: "bad", kind: "gpg", signer: null, key: null }).tone).toBe("bad");
    expect(describeSignature({ status: "unchecked", kind: "ssh", signer: null, key: null }).detail).toContain("allowedSignersFile");
  });
});
