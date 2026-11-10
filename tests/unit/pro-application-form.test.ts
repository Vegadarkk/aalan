import { describe, expect, it } from "vitest";
import {
  activitiesShown,
  draftProblems,
  initialDraft,
  legalFormsFor,
  type Draft,
} from "@/components/pro/pro-application-form";
import type { PieceState } from "@/components/pro/kybc-pieces";
import { cityBySlug } from "@/config/regions";
import type { ProSelfView } from "@/lib/contracts/pro";

// Pro application form (phase 7 design §4): the client checks mirror proApplySchema and
// proLegalSchema, so a refusal shows on its field before anything is sent.

const ready: PieceState = {
  key: "p1",
  name: "rc.pdf",
  phase: "ready",
  uploadId: "up1",
};

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    activity: "shop",
    name: "Atelier Salma",
    description: "",
    city: cityBySlug("casablanca") ?? null,
    form: "societe",
    country: null,
    ids: {
      ice: "001 234 567 000 089",
      rc: "12345",
      if: "4567890",
      aeNumber: "",
      tp: "",
      coopNumber: "",
      registry: "",
      vat: "",
    },
    phone: "",
    commitment: true,
    sectorCommitment: false,
    ...overrides,
  };
}

describe("draftProblems", () => {
  it("accepts a complete application", () => {
    expect(cityBySlug("casablanca")).toBeDefined();
    expect(draftProblems(draft(), [ready], false, "token")).toEqual({});
  });

  it("flags each missing or malformed field", () => {
    const empty = draft({
      activity: null,
      name: " ",
      city: null,
      form: null,
      commitment: false,
    });
    expect(draftProblems(empty, [], false, null)).toEqual({
      activity: "activityRequired",
      name: "required",
      city: "cityRequired",
      form: "required",
      pieces: "piecesRequired",
      commitment: "commitmentRequired",
      challenge: "challenge",
    });
    expect(draftProblems(draft({ name: "A" }), [ready], false, "t").name).toBe(
      "nameLength",
    );
    expect(
      draftProblems(
        draft({
          ids: {
            ice: "12345",
            rc: "",
            if: "IF#1",
            aeNumber: "",
            tp: "",
            coopNumber: "",
            registry: "",
            vat: "",
          },
        }),
        [ready],
        false,
        "t",
      ),
    ).toEqual({ ice: "iceFormat", rc: "required", if: "identifierFormat" });
  });

  it("asks the identifiers of the chosen legal form only", () => {
    const ae = draft({
      form: "auto_entrepreneur",
      ids: {
        ice: "001234567000089",
        rc: "",
        if: "",
        aeNumber: "",
        tp: "",
        coopNumber: "",
        registry: "",
        vat: "",
      },
    });
    expect(draftProblems(ae, [ready], false, "t")).toEqual({
      aeNumber: "required",
    });
    const trader = draft({
      form: "commercant",
      ids: {
        ice: "001234567000089",
        rc: "",
        if: "",
        aeNumber: "",
        tp: "",
        coopNumber: "",
        registry: "",
        vat: "",
      },
    });
    expect(draftProblems(trader, [ready], false, "t")).toEqual({
      rc: "rcOrTp",
    });
    expect(
      draftProblems(
        { ...trader, ids: { ...trader.ids, tp: "TP-55" } },
        [ready],
        false,
        "t",
      ),
    ).toEqual({});
    const coop = draft({
      form: "cooperative",
      ids: {
        ice: "001234567000089",
        rc: "",
        if: "",
        aeNumber: "",
        tp: "",
        coopNumber: "",
        registry: "",
        vat: "",
      },
    });
    expect(draftProblems(coop, [ready], false, "t")).toEqual({
      coopNumber: "required",
    });
    expect(
      draftProblems(
        { ...coop, ids: { ...coop.ids, coopNumber: "12/2019" } },
        [ready],
        false,
        "t",
      ),
    ).toEqual({});
  });

  it("asks the number to call only when the form needs it", () => {
    expect(draftProblems(draft(), [ready], true, "t")).toEqual({
      phone: "phoneRequired",
    });
    expect(
      draftProblems(draft({ phone: "05 22 00 00 00" }), [ready], true, "t"),
    ).toEqual({ phone: "phoneFormat" });
    for (const phone of [
      "06 12 34 56 78",
      "+212 712-345-678",
      "00212612345678",
    ])
      expect(
        draftProblems(draft({ phone }), [ready], true, "t"),
        phone,
      ).toEqual({});
  });

  it("asks an agency for its trade's commitments too, a dealership for the shop's only", () => {
    for (const activity of [
      "real_estate",
      "car_rental",
      "holiday_rental",
    ] as const) {
      expect(
        draftProblems(draft({ activity }), [ready], false, "t"),
        activity,
      ).toEqual({ sectorCommitment: "sectorCommitmentRequired" });
      expect(
        draftProblems(
          draft({ activity, sectorCommitment: true }),
          [ready],
          false,
          "t",
        ),
        activity,
      ).toEqual({});
    }
    expect(
      draftProblems(draft({ activity: "dealer" }), [ready], false, "t"),
    ).toEqual({});
  });

  it("waits for pieces still uploading and ignores refused ones", () => {
    const uploading: PieceState = {
      key: "p2",
      name: "tp.jpg",
      phase: "uploading",
      progress: 0.4,
    };
    const refused: PieceState = {
      key: "p3",
      name: "x.gif",
      phase: "rejected",
      reason: "bad_type",
    };
    expect(draftProblems(draft(), [ready, uploading], false, "t")).toEqual({
      pieces: "piecesPending",
    });
    expect(draftProblems(draft(), [refused], false, "t")).toEqual({
      pieces: "piecesRequired",
    });
  });
});

describe("carriers space", () => {
  const carrier = (overrides: Partial<Draft> = {}) =>
    draft({
      activity: "carrier",
      sectorCommitment: true,
      form: "entreprise_ue",
      country: "FR",
      ids: {
        ice: "",
        rc: "",
        if: "",
        aeNumber: "",
        tp: "",
        coopNumber: "",
        registry: "732 829 320",
        vat: "",
      },
      ...overrides,
    });

  it("offers the carrier activity only while the space is open, and the EU form to a carrier only", () => {
    expect(activitiesShown(false, null)).not.toContain("carrier");
    expect(activitiesShown(true, null)).toContain("carrier");
    expect(activitiesShown(false, "carrier")).toContain("carrier");
    expect(legalFormsFor("shop")).not.toContain("entreprise_ue");
    expect(legalFormsFor("carrier")).toContain("entreprise_ue");
  });

  it("checks an EU company's country, register number and VAT number", () => {
    expect(draftProblems(carrier(), [ready], false, "t")).toEqual({});
    expect(
      draftProblems(carrier({ country: null }), [ready], false, "t"),
    ).toEqual({ country: "required" });
    expect(
      draftProblems(
        carrier({ ids: { ...carrier().ids, registry: "732 829 321" } }),
        [ready],
        false,
        "t",
      ),
    ).toEqual({ registry: "registryFormat" });
    expect(
      draftProblems(
        carrier({ ids: { ...carrier().ids, vat: "BE0403170701" } }),
        [ready],
        false,
        "t",
      ),
    ).toEqual({ vat: "vatFormat" });
    expect(
      draftProblems(
        carrier({ ids: { ...carrier().ids, vat: "FR44732829320" } }),
        [ready],
        false,
        "t",
      ),
    ).toEqual({});
  });

  it("takes an EU mobile in its international form from an EU company only", () => {
    expect(
      draftProblems(
        carrier({ phone: "+33 6 12 34 56 78" }),
        [ready],
        true,
        "t",
      ),
    ).toEqual({});
    expect(
      draftProblems(carrier({ phone: "06 12 34 56 78" }), [ready], true, "t"),
    ).toEqual({});
    expect(
      draftProblems(carrier({ phone: "+44 7911 123456" }), [ready], true, "t"),
    ).toEqual({ phone: "phoneFormatEu" });
    expect(
      draftProblems(draft({ phone: "+33 6 12 34 56 78" }), [ready], true, "t"),
    ).toEqual({ phone: "phoneFormat" });
  });
});

describe("initialDraft", () => {
  it("prefills a rejected application with what the server sends back", () => {
    const previous = {
      name: "Atelier Salma",
      description: "Céramique",
      citySlug: "casablanca",
      legalForm: "commercant",
      ice: "001234567000089",
      sector: "general",
    } as ProSelfView;
    const filled = initialDraft(previous);
    expect(filled).toMatchObject({
      activity: "shop",
      name: "Atelier Salma",
      description: "Céramique",
      form: "commercant",
      commitment: false,
      sectorCommitment: false,
    });
    expect(filled.city?.slug).toBe("casablanca");
    expect(filled.ids).toEqual({
      ice: "001234567000089",
      rc: "",
      if: "",
      aeNumber: "",
      tp: "",
      coopNumber: "",
      registry: "",
      vat: "",
    });
    // An agency's sector comes back as its activity; the commitments are ticked again.
    expect(initialDraft({ ...previous, sector: "real_estate" }).activity).toBe(
      "real_estate",
    );
    expect(initialDraft(null)).toMatchObject({ activity: null, form: null });
  });
});
