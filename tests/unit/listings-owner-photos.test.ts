import { describe, expect, it } from "vitest";
import { OWNER_MEDIA_BASE, ownerMediaBase, photoUrl } from "@/lib/listings/client/photo-url";
import { OWNER_PHOTO_CACHE_CONTROL, parseOwnerPhotoParams } from "@/lib/listings/owner-photos";

// The owner's own views of a refused, removed or hidden listing (audit C-3): its photos left the
// media host, so « Mes annonces » and the wizard read them through /api/owner-media, under the same
// `listings/{id}/{photoId}-{variant}.webp` paths; the route's segments are validated.

const LISTING = "abcd2345";
const PHOTO = "photo00000000001";

describe("owner media base", () => {
  it("switches to the owner route only for a listing whose photos are private", () => {
    expect(ownerMediaBase({}, "https://media.joutiya.ma")).toBe("https://media.joutiya.ma");
    expect(ownerMediaBase({ privatePhotos: true }, "https://media.joutiya.ma")).toBe(OWNER_MEDIA_BASE);
    expect(ownerMediaBase({ privatePhotos: true }, null)).toBe(OWNER_MEDIA_BASE);
    expect(photoUrl(OWNER_MEDIA_BASE, LISTING, PHOTO, "s")).toBe(`/api/owner-media/listings/${LISTING}/${PHOTO}-s.webp`);
  });
});

describe("owner photo route", () => {
  it("parses the photo id and a known variant from the file name", () => {
    expect(parseOwnerPhotoParams({ id: LISTING, file: `${PHOTO}-s.webp` })).toEqual({ listingId: LISTING, photoId: PHOTO, variant: "s" });
    expect(parseOwnerPhotoParams({ id: LISTING, file: `${PHOTO}-m.webp` })?.variant).toBe("m");
  });

  it("refuses anything else", () => {
    for (const params of [
      { id: "ABCD2345", file: `${PHOTO}-s.webp` },
      { id: LISTING, file: `${PHOTO}-x.webp` },
      { id: LISTING, file: `${PHOTO}-s.jpg` },
      { id: LISTING, file: `../${PHOTO}-s.webp` },
      { id: LISTING, file: `short-s.webp` },
      { id: LISTING, file: [`${PHOTO}-s.webp`] },
      { id: LISTING },
    ]) {
      expect(parseOwnerPhotoParams(params)).toBeNull();
    }
  });

  it("is cached by the owner's browser only", () => {
    expect(OWNER_PHOTO_CACHE_CONTROL.startsWith("private,")).toBe(true);
  });
});
