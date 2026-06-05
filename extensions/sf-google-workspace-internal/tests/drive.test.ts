/* SPDX-License-Identifier: Apache-2.0 */
import { test, assert } from "vitest";
import {
  buildDriveSearchArgs,
  formatDriveSearchResult,
  parseDriveSearchText,
} from "../lib/drive.ts";

const SAMPLE = `Found 2 files for user@example.com matching 'headless 360':
- Name: "Headless 360 - UNHCR" (ID: 1pgvJwfm5-Zovhkcxu_Aey5VXnRjORPQthDDwaVArRAU, Type: application/vnd.google-apps.presentation, Size: 114257101, Modified: 2026-05-27T09:16:31.561Z) Link: https://docs.google.com/presentation/d/1pgvJwfm5-Zovhkcxu_Aey5VXnRjORPQthDDwaVArRAU/edit?usp=drivesdk
- Name: "Headless 360 — draft edits for Andrea CTO guide v2.txt" (ID: 1fOSE-i-tqf1V_RN1feCUpNufgaJTpjaU, Type: text/plain, Size: 6510, Modified: 2026-05-13T08:00:44.151Z) Link: https://drive.google.com/file/d/1fOSE-i-tqf1V_RN1feCUpNufgaJTpjaU/view?usp=drivesdk
nextPageToken: ~!!~AI9FV7TokenWrapped
AcrossLines==`;

test("buildDriveSearchArgs maps friendly params to MCP schema", () => {
  assert.deepEqual(buildDriveSearchArgs({ query: "headless 360", limit: 5, file_type: "slides" }), {
    query: "headless 360",
    page_size: 5,
    include_items_from_all_drives: true,
    detailed: true,
    file_type: "slides",
  });
});

test("parseDriveSearchText extracts files and pagination token", () => {
  const result = parseDriveSearchText("headless 360", SAMPLE);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0]?.name, "Headless 360 - UNHCR");
  assert.equal(result.files[0]?.typeLabel, "Presentation");
  assert.equal(result.files[1]?.typeLabel, "Text");
  assert.equal(result.nextPageToken, "~!!~AI9FV7TokenWrappedAcrossLines==");
});

test("formatDriveSearchResult hides raw page token but preserves has-more guidance", () => {
  const formatted = formatDriveSearchResult(parseDriveSearchText("headless 360", SAMPLE));
  assert.ok(formatted.includes("Headless 360 - UNHCR"));
  assert.ok(formatted.includes("More results are available"));
  assert.ok(!formatted.includes("AI9FV7TokenWrapped"));
});
