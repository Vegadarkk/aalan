// Owner tooling variables are moving from JOUTIYA_* to AALAN_* (internal rename, owner 30 Oct and
// 2 Nov 2026). A script reads AALAN_<name> first, then the former JOUTIYA_<name>, until every
// environment (cloud, PC2 .env.local) carries the new names and the fallback is dropped. Never the
// unprefixed name: the cloud environment is shared with other projects.

export function ownerVar(name: string, env: Record<string, string | undefined> = process.env): string {
  return env[`AALAN_${name}`]?.trim() || env[`JOUTIYA_${name}`]?.trim() || "";
}

/** Like ownerVar, but throws when neither name is set. */
export function requireOwnerVar(name: string, env: Record<string, string | undefined> = process.env): string {
  const value = ownerVar(name, env);
  if (!value) throw new Error(`AALAN_${name} is not set (nor its former name JOUTIYA_${name})`);
  return value;
}
