import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { registerIsolatedPostgres } from "../database/postgres-test-database";

const fixture = registerIsolatedPostgres({
  migrationDirectories: [
    resolve(process.cwd(), "tests/integration/fixtures/migrations"),
  ],
});

describe("isolated PostgreSQL test database", () => {
  it("applies SQL migrations to a fresh test database", async () => {
    const { pool } = fixture.current;
    const id = randomUUID();

    await pool.query("INSERT INTO test_records (id, value) VALUES ($1, $2)", [
      id,
      "first test",
    ]);

    const result = await pool.query<{ value: string }>(
      "SELECT value FROM test_records WHERE id = $1",
      [id],
    );
    const timezone = await pool.query<{ TimeZone: string }>("SHOW TIME ZONE");

    expect(result.rows).toEqual([{ value: "first test" }]);
    expect(timezone.rows[0]?.TimeZone).toBe("UTC");
  });

  it("starts the next test with no data from the previous test", async () => {
    const result = await fixture.current.pool.query<{ count: string }>(
      "SELECT count(*) FROM test_records",
    );

    expect(result.rows[0]?.count).toBe("0");
  });
});
