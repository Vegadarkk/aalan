import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PRICING } from "../src/config/pricing.ts";
import { mergeOver, planRuntime, updateMaskQuery } from "./runtime-config.ts";

// Runs under plain Node (no `@/` alias), as the script does on the owner's machine.
test("flags: writes the given flags only, refuses unknown ones and opening sales in production", () => {
  assert.deepEqual(planRuntime("staging", "flags", { salesEnabled: true }), { write: { salesEnabled: true }, errors: [] });
  assert.deepEqual(planRuntime("staging", "flags", { salesEnable: true }).errors, ["salesEnable: unknown flag"]);
  assert.equal(planRuntime("staging", "flags", { salesEnabled: "yes" }).errors.length, 1);
  assert.equal(planRuntime("prod", "flags", { salesEnabled: true }).errors.length, 1);
  assert.deepEqual(planRuntime("prod", "flags", { salesEnabled: false }).errors, []);
  assert.deepEqual(planRuntime("staging", "flags", {}).errors, ["the file must hold a non-empty JSON object"]);
  assert.deepEqual(planRuntime("staging", "flags", []).errors, ["the file must hold a non-empty JSON object"]);
});

test("pricing: partial values are merged over the defaults, lists by id", () => {
  const { write, errors } = planRuntime("staging", "pricing", {
    plans: { essentiel: { stripePrices: { monthly: "price_A1", yearly: "price_A2" } }, business: { stripePrices: { monthly: "price_B1" } } },
    passes: [{ id: "boutique30", stripePrice: "price_P1" }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(write), ["plans", "passes"]);
  assert.deepEqual(write.plans, {
    essentiel: { ...DEFAULT_PRICING.plans.essentiel, stripePrices: { monthly: "price_A1", yearly: "price_A2" } },
    business: { ...DEFAULT_PRICING.plans.business, stripePrices: { monthly: "price_B1" } },
  });
  assert.deepEqual(write.passes, [{ ...DEFAULT_PRICING.passes[0], stripePrice: "price_P1" }]);
});

test("pricing: unknown keys and invalid values are refused", () => {
  assert.deepEqual(planRuntime("staging", "pricing", { plan: {} }).errors, ["plan: unknown pricing key"]);
  const invalid = planRuntime("staging", "pricing", { plans: { essentiel: { stripePrices: { monthly: "prod_X" } } } });
  assert.equal(invalid.errors.length, 1);
  assert.match(invalid.errors[0] ?? "", /^plans\.essentiel\.stripePrices\.monthly/);
});

test("mergeOver keeps unlisted items, adds new ids and replaces scalars and plain lists", () => {
  assert.deepEqual(mergeOver([{ id: "a", x: 1 }, { id: "b", x: 2 }], [{ id: "b", x: 3 }, { id: "c", x: 4 }]), [{ id: "a", x: 1 }, { id: "b", x: 3 }, { id: "c", x: 4 }]);
  assert.deepEqual(mergeOver([1, 2], [3]), [3]);
  assert.deepEqual(mergeOver({ a: { b: 1, c: 2 } }, { a: { c: 3 }, d: 4 }), { a: { b: 1, c: 3 }, d: 4 });
  assert.equal(mergeOver({ a: 1 }, null), null);
});

test("update mask quotes each top-level key", () => {
  assert.equal(updateMaskQuery(["plans", "passes"]), "updateMask.fieldPaths=%60plans%60&updateMask.fieldPaths=%60passes%60");
});
