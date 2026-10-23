import { describe, expect, it } from "vitest";
import { createDisabledClientScenesService } from "#src/client-scenes/clientScenesService.js";

describe("DisabledClientScenesService", () => {
  it("returns an empty list without network access", async () => {
    await expect(createDisabledClientScenesService().list()).resolves.toEqual({
      code: 0,
      msg: "",
      data: [],
    });
  });
});
