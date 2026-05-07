/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildApiPath, normalizeD360Path } from "../lib/path.ts";

describe("sf-data360 path helpers", () => {
  it("normalizes resource paths", () => {
    expect(normalizeD360Path("ssot/data-model-objects")).toBe("/ssot/data-model-objects");
    expect(normalizeD360Path("/ssot/data-model-objects")).toBe("/ssot/data-model-objects");
  });

  it("strips supplied services/data version so the active API version wins", () => {
    expect(normalizeD360Path("/services/data/v60.0/ssot/query-sql")).toBe("/ssot/query-sql");
    expect(buildApiPath("/services/data/v60.0/ssot/query-sql", "66.0")).toBe(
      "/services/data/v66.0/ssot/query-sql",
    );
  });

  it("builds repeated query parameters", () => {
    expect(
      buildApiPath("/ssot/metadata", "66.0", {
        entityType: "DataModelObject",
        tag: ["one", "two"],
        includeInactive: false,
        skip: undefined,
      }),
    ).toBe(
      "/services/data/v66.0/ssot/metadata?entityType=DataModelObject&tag=one&tag=two&includeInactive=false",
    );
  });
});
