// E.164 patterns of the numbers an account may verify, without the phone metadata (client bundles
// import the profile schemas). The exact ranges are checked by src/lib/phone/normalize.ts.

/** E.164 of a Moroccan mobile: +212 6xx xxx xxx or +212 7xx xxx xxx. */
export const MOROCCAN_MOBILE_E164 = /^\+212[67]\d{8}$/;
/** E.164 of an EU carrier's mobile (carriers space, KYBC form "entreprise_ue"): FR, BE, NL, ES, IT, DE, PT. */
export const EU_MOBILE_E164 = /^\+(?:33|32|31|34|39|49|351)\d{6,12}$/;
/** A Moroccan mobile, or an EU carrier's: what a verified number may be. */
export const MOBILE_E164 =
  /^\+212[67]\d{8}$|^\+(?:33|32|31|34|39|49|351)\d{6,12}$/;
