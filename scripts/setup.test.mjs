import assert from "node:assert/strict";
import test from "node:test";
import { getDatabaseId, parseUuid, parseWorkerUrl, setDatabaseId } from "./setup.mjs";

test("parseUuid", () => assert.equal(parseUuid('database_id = "e6165d29-9710-444d-8ebb-a546f8434377"'), "e6165d29-9710-444d-8ebb-a546f8434377"));
test("parseUuid none", () => assert.equal(parseUuid("nothing"), null));
test("parseWorkerUrl", () => assert.equal(parseWorkerUrl("Deployed x\n  https://mcu-bridge.me.workers.dev\nVersion"), "https://mcu-bridge.me.workers.dev"));
test("toml database id", () => {
  const t = '[[d1_databases]]\nbinding = "DB"\ndatabase_id = "0000"\n';
  assert.equal(getDatabaseId(setDatabaseId(t, "abc-1")), "abc-1");
});

import { planParts } from "./publish-installer.mjs";
test("planParts splits into <=limit parts that sum to the total", () => {
  const sizes = planParts(29389606);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 29389606);
  assert.ok(sizes.every((s) => s <= 10 * 1024 * 1024));
  assert.equal(sizes.length, 3);
  assert.deepEqual(planParts(5), [5]);
});
