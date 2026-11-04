import { describe, expect, it } from "vitest";
import { CAR_MODELS, CAR_MODEL_IDS, carModelOf, carModelsOf } from "@/config/car-models";
import { CAR_BRANDS, criterionById, searchCriteria } from "@/config/categories";
import { cardFactsOf } from "@/lib/listings/card-facts";
import { canonicalSearchParams, parseSearchParams, searchParamsToQuery } from "@/lib/search/params";
import { EQUALITY_FILTERS } from "@/lib/search/settings";

// Catalogue car models (audit lot 7, zone 2 P1-1 / P1-3 / P1-4).

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("car models", () => {
  it("has unique kebab-case ids of known brands, each with a label and a spelling", () => {
    expect(new Set(CAR_MODEL_IDS).size).toBe(CAR_MODEL_IDS.length);
    for (const model of CAR_MODELS) {
      expect(model.id, model.id).toMatch(KEBAB);
      expect(model.id.startsWith(`${model.brand}-`), model.id).toBe(true);
      expect(CAR_BRANDS as readonly string[]).toContain(model.brand);
      expect(model.label.trim(), model.id).not.toBe("");
      expect(model.spellings.length, model.id).toBeGreaterThan(0);
    }
  });

  it("guards a model spelled as a number or a short code", () => {
    for (const model of CAR_MODELS) for (const spelling of model.spellings) if (/^[a-z]?\d+$/.test(spelling)) expect(model.guarded, `${model.id} ${spelling}`).toBe(true);
  });

  it.each([
    ["renault", "Clio 4 dCi 90", "renault-clio"],
    ["renault", "clio4", "renault-clio"],
    ["renault", "CLIO IV", "renault-clio"],
    ["renault", "Mégane 3", "renault-megane"],
    ["dacia", "Sandero Stepway", "dacia-sandero-stepway"],
    ["dacia", "Sandero", "dacia-sandero"],
    ["mercedes-benz", "C 220 CDI", "mercedes-benz-classe-c"],
    ["mercedes-benz", "Classe E 250", "mercedes-benz-classe-e"],
    ["bmw", "320d", "bmw-serie-3"],
    ["bmw", "X5 xDrive", "bmw-x5"],
    ["land-rover", "Range Rover Evoque", "land-rover-range-rover-evoque"],
    ["peugeot", "208 GT Line", "peugeot-208"],
    ["volkswagen", "Golf 7 GTD", "volkswagen-golf"],
    ["dacia", "لوغان", "dacia-logan"],
  ])("reads %s %j as %s", (brand, text, id) => {
    expect(carModelOf(brand, text)).toBe(id);
  });

  it("finds no model of another brand, nor in an unknown text", () => {
    expect(carModelOf("peugeot", "Clio")).toBeUndefined();
    expect(carModelOf("renault", "R4 de collection")).toBeUndefined();
    expect(carModelOf("autre", "Clio")).toBeUndefined();
    expect(carModelOf(undefined, "Clio")).toBeUndefined();
    expect(carModelOf("renault", 4)).toBeUndefined();
  });

  it("is a search-only filter after the brand, filterable in the index", () => {
    expect(criterionById("car-model")?.options).toBe(CAR_MODEL_IDS);
    const ids = searchCriteria("vehicules", "voitures").map((criterion) => criterion.id);
    expect(ids.indexOf("car-model")).toBe(ids.indexOf("car-brand") + 1);
    expect(searchCriteria("vehicules", "location-voitures").map((criterion) => criterion.id)).toContain("car-model");
    expect(searchCriteria("vehicules", "pieces-accessoires").map((criterion) => criterion.id)).not.toContain("car-model");
    expect(EQUALITY_FILTERS).toContain("a_car_model");
    expect(carModelsOf(["dacia"]).every((model) => model.brand === "dacia")).toBe(true);
  });

  it("keeps the models of the filtered brands only, in the URL too", () => {
    const params = parseSearchParams(new URLSearchParams("sous-categorie=voitures&f-car-brand=renault&f-car-model=renault-clio,dacia-logan"));
    expect(params.criteria?.["car-model"]).toEqual({ kind: "options", values: ["renault-clio"] });
    expect(searchParamsToQuery(params).get("f-car-model")).toBe("renault-clio");
    expect(canonicalSearchParams({ subcategory: "voitures", criteria: { "car-brand": { kind: "options", values: ["peugeot"] }, "car-model": { kind: "options", values: ["renault-clio"] } } }).criteria).toEqual({ "car-brand": { kind: "options", values: ["peugeot"] } });
    // Without a brand filter, a model stays (it names its brand).
    expect(parseSearchParams(new URLSearchParams("sous-categorie=voitures&f-car-model=dacia-logan")).criteria).toEqual({ "car-model": { kind: "options", values: ["dacia-logan"] } });
  });
});

describe("vehicle card facts", () => {
  it("shows year, mileage, fuel and gearbox of a car, never « autre »", () => {
    const attributes: Record<string, unknown> = { year: 2016, mileage: 120000, fuel: "diesel", gearbox: "manuelle", "car-brand": "renault" };
    expect(cardFactsOf("voitures", (id) => attributes[id]).facts).toEqual([
      { id: "year", value: 2016 },
      { id: "mileage", value: 120000 },
      { id: "fuel", value: "diesel" },
      { id: "gearbox", value: "manuelle" },
    ]);
    expect(cardFactsOf("motos-scooters", (id) => ({ year: 2020, mileage: 8000 })[id]).facts.map((fact) => fact.id)).toEqual(["year", "mileage"]);
    expect(cardFactsOf("voitures", (id) => ({ fuel: "electrique", gearbox: "autre" })[id]).facts).toEqual([{ id: "fuel", value: "electrique" }]);
  });
});
