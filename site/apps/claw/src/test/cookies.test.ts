import { beforeEach, describe, expect, it } from "vitest";

import { cookieUtils } from "../../../../packages/shared-ui/src/utils/cookies";

describe("cookieUtils.remove", () => {
  beforeEach(() => {
    document.cookie = "auth_token=; path=/; max-age=0";
  });

  it("does not emit a change event when the cookie was already absent", () => {
    let calls = 0;
    const listener = () => {
      calls += 1;
      cookieUtils.remove("auth_token");
    };
    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, listener);

    cookieUtils.remove("auth_token");

    window.removeEventListener(cookieUtils.AUTH_COOKIE_EVENT, listener);
    expect(calls).toBe(0);
  });

  it("emits once for a real removal without re-entrant recursion", () => {
    document.cookie = "auth_token=abc; path=/";
    let calls = 0;
    const listener = () => {
      calls += 1;
      cookieUtils.remove("auth_token");
    };
    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, listener);

    cookieUtils.remove("auth_token");

    window.removeEventListener(cookieUtils.AUTH_COOKIE_EVENT, listener);
    expect(calls).toBe(1);
    expect(cookieUtils.has("auth_token")).toBe(false);
  });
});
