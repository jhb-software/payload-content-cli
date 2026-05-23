import { describe, it, expect } from "vitest";
import { buildKeychainCommand, isManagedKeychainCommand } from "../keychain.js";

describe("buildKeychainCommand", () => {
  it("quotes service and account so names with spaces or apostrophes survive sh -c", () => {
    const cmd = buildKeychainCommand("my prod");
    expect(cmd).toBe("security find-generic-password -w -s 'payload-content/my prod' -a 'my prod'");
  });

  it("escapes embedded single quotes", () => {
    const cmd = buildKeychainCommand("o'reilly");
    expect(cmd).toContain(`'payload-content/o'\\''reilly'`);
    expect(cmd).toContain(`'o'\\''reilly'`);
  });
});

describe("isManagedKeychainCommand", () => {
  it("returns true for the exact command we would have generated", () => {
    expect(isManagedKeychainCommand("prod", buildKeychainCommand("prod"))).toBe(true);
  });

  it("returns false for a user-authored credential helper", () => {
    expect(isManagedKeychainCommand("prod", "op read 'op://Private/payload-prod/api-key'")).toBe(
      false,
    );
    expect(isManagedKeychainCommand("prod", "pass show payload/prod")).toBe(false);
  });

  it("returns false when the profile name doesn't match the command", () => {
    // Protects `profile remove staging` from nuking the `prod` Keychain entry.
    expect(isManagedKeychainCommand("staging", buildKeychainCommand("prod"))).toBe(false);
  });

  it("returns false when no credentialCommand is set", () => {
    expect(isManagedKeychainCommand("prod", undefined)).toBe(false);
  });
});
