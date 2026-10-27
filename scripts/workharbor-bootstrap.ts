import path from "node:path";
import { ensureAgentJwtSecret, loadPaperclipEnvFile } from "../cli/src/config/env.js";

const configPath = process.argv[2];
if (!configPath || !path.isAbsolute(configPath) || configPath !== process.env.PAPERCLIP_CONFIG) {
  throw new Error("WorkHarbor bootstrap requires its explicit selected instance config path.");
}

// Preserve both signing-key sources supported by the server, without onboarding.
loadPaperclipEnvFile(configPath);
if (!process.env.BETTER_AUTH_SECRET?.trim()) ensureAgentJwtSecret(configPath);
