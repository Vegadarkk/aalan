// Unit tests never reach a real provider: the cloud shell that runs them may hold keys of other
// projects (CLAUDE.md "Accounts and keys"), and a module reading the ambient env would call the live
// API with them (security audit of 4 Nov 2026). CI has none of these: blanking them matches CI.
const SECRET_NAME = /(^|_)(API_KEY|SECRET|SECRET_KEY|TOKEN|PRIVATE_KEY|DSN|PASSWORD)(_|$)/;

for (const name of Object.keys(process.env)) {
  if (SECRET_NAME.test(name)) delete process.env[name];
}
