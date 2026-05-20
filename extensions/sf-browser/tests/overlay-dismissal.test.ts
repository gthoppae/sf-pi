/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Ambient Overlay Dismissal snapshot parsing. */
import { describe, expect, it } from "vitest";
import { findAmbientOverlayCloseRefs } from "../lib/overlay-dismissal.ts";

describe("ambient overlay dismissal", () => {
  it("finds close refs for the known security contact overlay", () => {
    const snapshot = [
      '- heading "Action Required: Security Contact Missing" [level=2, ref=e17]',
      '- button "Minimize" [ref=e20]',
      '- button "Maximize" [ref=e21]',
      '- button "Close" [ref=e22]',
    ].join("\n");

    expect(findAmbientOverlayCloseRefs(snapshot)).toEqual(["e22"]);
  });

  it("finds explicit close-banner controls", () => {
    expect(findAmbientOverlayCloseRefs('- button "Close banner" [ref=e145]')).toEqual(["e145"]);
  });

  it("does not click generic close buttons without a known ambient marker", () => {
    const snapshot = [
      '- heading "Create Agent" [level=2, ref=e1]',
      '- button "Close" [ref=e2]',
    ].join("\n");

    expect(findAmbientOverlayCloseRefs(snapshot)).toEqual([]);
  });
});
