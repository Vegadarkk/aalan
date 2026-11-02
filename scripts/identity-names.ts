// Names of the Google identities in a Firebase project (Workload Identity Federation, §9). The
// aalan-* projects (rebrand, 2 Nov 2026) use aalan-* names; a former joutiya-* project keeps the
// names it was set up with until it is deleted. Shared by google-wif.ts and vm-env.ts.

export function identityPrefix(project: string): "aalan" | "joutiya" {
  return project.startsWith("joutiya-") ? "joutiya" : "aalan";
}

/** Service account of web, worker or the CI deployer. */
export function accountName(project: string, role: "web" | "worker" | "deployer"): string {
  return `${identityPrefix(project)}-${role}`;
}

export function serviceAccountEmail(name: string, project: string): string {
  return `${name}@${project}.iam.gserviceaccount.com`;
}
