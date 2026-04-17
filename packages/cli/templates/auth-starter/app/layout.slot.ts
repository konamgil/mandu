/**
 * Layout loader — runs on every page render and provides
 * `{ authed, csrfToken }` to `layout.tsx` so the header can switch
 * between guest and logged-in nav states.
 *
 * Wired automatically: `app/layout.tsx` looks for `app/layout.slot.ts`
 * by filename convention.
 */
import { Mandu } from "@mandujs/core";
import { attachAuthContext } from "../src/lib/auth";

export default Mandu.filling().loader(async (ctx) => {
  const { userId, csrfToken } = await attachAuthContext(ctx);
  return {
    authed: userId !== null,
    csrfToken,
  };
});
