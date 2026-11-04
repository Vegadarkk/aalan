# Staging test listings: photos

The listings made on staging for the tests (payments, messaging, the test shop) get real photos that
match their titles, so a demo of staging looks like the real site. The example listings already get
theirs from the seed (`src/lib/demo/catalog.ts`, Pexels, also used for production).

Script: `scripts/listing-photos.ts`, run in the staging worker:

```
docker compose exec worker node dist/worker/listing-photos.mjs list
docker compose exec worker node dist/worker/listing-photos.mjs set <listingId>=<pexelsId>[,<pexelsId>...] [--apply]
```

Each photo goes through the member pipeline (quarantine, `processUpload`: re-encode, local checks,
WebP variants), then replaces the listing's photos; the old uploads are deleted. Staging only.

Rules, as for the examples: one photo shows the product of the title (same object, colour, count),
no readable plate, brand sign or face; a Pexels photo serves one listing only and none already used by
the catalog.

## Photos in use

All under the [Pexels License](https://www.pexels.com/license/) (free, commercial use, no attribution
required, no sale of unaltered copies).

| Listing (staging) | Title | Pexels photo | Author |
| --- | --- | --- | --- |
| `9nmuj9uj` | Lampe de bureau test paiement | [1112598](https://www.pexels.com/photo/black-metal-desk-lamp-1112598/) | Eneida Nieves |
