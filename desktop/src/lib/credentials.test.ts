/**
 * Credential-error normalisation — the seam that decides "no key on disk"
 * (sign-in screen) from "something else broke" (`degraded`).
 *
 * The regression this file exists for: the Rust SDK reworded
 * `ConfigError::MissingCredential` and the loose JS regex in `fsm.ts` stopped
 * matching, so a fresh install classified its missing `~/.hypercli/config` as
 * an unknown failure and dead-ended on the reconnecting splash.
 */
import { describe, expect, it } from "vitest";
import {
  MissingCredentialError,
  RUST_ABSENT_CREDENTIAL_MESSAGES,
  normalizeCredentialError,
} from "./credentials";

describe("normalizeCredentialError", () => {
  it.each(RUST_ABSENT_CREDENTIAL_MESSAGES)(
    "normalises the Rust ConfigError %j delivered as a bare IPC string",
    (rustMessage) => {
      // Tauri command errors cross the bridge as plain strings, not Errors.
      const normalised = normalizeCredentialError(rustMessage);
      expect(normalised).toBeInstanceOf(MissingCredentialError);
      expect((normalised as MissingCredentialError).message).toBe(rustMessage);
    },
  );

  it.each(RUST_ABSENT_CREDENTIAL_MESSAGES)(
    "normalises the same message wrapped in an Error",
    (rustMessage) => {
      expect(normalizeCredentialError(new Error(rustMessage))).toBeInstanceOf(
        MissingCredentialError,
      );
    },
  );

  it("passes a MissingCredentialError through untouched", () => {
    const error = new MissingCredentialError("already classified");
    expect(normalizeCredentialError(error)).toBe(error);
  });

  it("passes genuinely unknown failures through by identity", () => {
    // Unknown must survive so the machine can degrade on it — folding it into
    // "no credential" is precisely the false sign-out FSM.md §1 forbids.
    const error = new Error("something completely different");
    expect(normalizeCredentialError(error)).toBe(error);
    expect(normalizeCredentialError("no credential for you")).not.toBeInstanceOf(
      MissingCredentialError,
    );
  });
});
