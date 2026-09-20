import { describe, expect, it } from "vitest";
import { MemorySpacetimeClient, parseSqlRows, resolveSpacetimeConfig } from "./client.js";

describe("resolveSpacetimeConfig", () => {
  it("defaults to the local standalone install", () => {
    expect(resolveSpacetimeConfig({})).toEqual({
      url: "http://127.0.0.1:3000",
      database: "dissect",
      token: null,
    });
  });

  it("can be disabled", () => {
    expect(resolveSpacetimeConfig({ DISSECT_SPACETIMEDB_DISABLED: "1" })).toBeNull();
  });
});

describe("parseSqlRows", () => {
  it("reads object rows from a table payload", () => {
    expect(parseSqlRows([{ rows: [{ project_id: "abc", payload_json: "{}" }] }])).toEqual([
      { project_id: "abc", payload_json: "{}" },
    ]);
  });

  it("zips positional rows with schema column names", () => {
    expect(
      parseSqlRows([
        {
          schema: {
            elements: [{ name: { some: "project_id" } }, { name: "payload_json" }],
          },
          rows: [["abc", "{}"]],
        },
      ]),
    ).toEqual([{ project_id: "abc", payload_json: "{}" }]);
  });
});

describe("MemorySpacetimeClient", () => {
  it("keeps only the first architecture cache write", async () => {
    const client = new MemorySpacetimeClient();
    client.enqueue({
      reducer: "cache_codebase_architecture",
      args: { project_id: "p1", payload_json: "first", snapshot_id: "s1" },
    });
    client.enqueue({
      reducer: "cache_codebase_architecture",
      args: { project_id: "p1", payload_json: "second", snapshot_id: "s2" },
    });
    const rows = await client.querySql(
      "SELECT project_id, snapshot_id, payload_json FROM codebase_architecture WHERE project_id = 'p1'",
    );
    expect(rows).toMatchObject([{ project_id: "p1", payload_json: "first", snapshot_id: "s1" }]);
  });
});
