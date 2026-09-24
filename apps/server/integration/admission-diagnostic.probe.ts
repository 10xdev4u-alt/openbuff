// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off - one-shot diagnostic, not an Effect program.
/** Dump the FULL admission gate response body once — no retries, no loops. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const credPath = path.join(os.homedir(), ".config/manicode/credentials.json");
const creds = JSON.parse(fs.readFileSync(credPath, "utf8")) as {
  default?: { authToken?: string; email?: string };
};
const token = creds.default?.authToken;
if (!token) {
  console.error("no token");
  process.exit(1);
}

const response = await fetch("https://www.codebuff.com/api/v1/freebuff/session/admission", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "x-fb-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "x-freebuff-first-tab-discount": "0",
    "x-freebuff-model": "z-ai/glm-5.3-flash",
    "x-freebuff-wallet-spend-limit": "0",
  },
});
console.log("HTTP", response.status);
const text = await response.text();
console.log(text.slice(0, 800));
