#!/usr/bin/env node
/**
 * Mint a Google OAuth2 refresh token for the Google Groups sync integration.
 *
 * Prerequisites in Google Cloud Console:
 *   1. The OAuth client used here MUST have `http://localhost:3030/oauth/callback`
 *      registered as an Authorized redirect URI.
 *   2. The OAuth consent screen should be Published (or the impersonation account
 *      added as a Test user) so the refresh token doesn't expire in 7 days.
 *
 * Usage (from repo root):
 *   GOOGLE_GROUPS_CLIENT_ID=... GOOGLE_GROUPS_CLIENT_SECRET=... \
 *     node scripts/mint-google-refresh-token.mjs
 *
 * Or, if you have the downloaded client JSON file:
 *   node scripts/mint-google-refresh-token.mjs path/to/client_secret.json
 *
 * Sign in as the Workspace account that should be impersonated
 * (e.g. api@westervillelions.org). The refresh token will be printed at the end —
 * paste it into Vercel as GOOGLE_GROUPS_REFRESH_TOKEN.
 */

import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

const PORT = 3030;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/apps.groups.settings",
];

function readClientCredentials() {
  const jsonPath = process.argv[2];
  if (jsonPath) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const block = raw.web ?? raw.installed;
    if (!block?.client_id || !block?.client_secret) {
      throw new Error("JSON file must contain a 'web' or 'installed' block with client_id and client_secret");
    }
    return { clientId: block.client_id, clientSecret: block.client_secret };
  }

  const clientId = process.env.GOOGLE_GROUPS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GROUPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Pass a path to the client_secret JSON, or set GOOGLE_GROUPS_CLIENT_ID and GOOGLE_GROUPS_CLIENT_SECRET in the environment."
    );
  }
  return { clientId, clientSecret };
}

function openInBrowser(url) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"` :
    process.platform === "win32" ? `start "" "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function exchangeCodeForTokens({ code, clientId, clientSecret }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function buildAuthUrl({ clientId, state }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function main() {
  const { clientId, clientSecret } = readClientCredentials();
  const state = crypto.randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl({ clientId, state });

  console.log("\nWaiting for OAuth callback on", REDIRECT_URI);
  console.log("If your browser doesn't open automatically, visit:\n");
  console.log(" ", authUrl, "\n");

  const result = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        if (url.pathname !== "/oauth/callback") {
          res.writeHead(404).end("Not found");
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        if (errorParam) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${errorParam}`);
          server.close();
          reject(new Error(`OAuth error: ${errorParam}`));
          return;
        }
        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing code or state mismatch");
          server.close();
          reject(new Error("Missing code or state mismatch"));
          return;
        }

        const tokens = await exchangeCodeForTokens({ code, clientId, clientSecret });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
          "<html><body style='font-family:sans-serif;padding:40px;'><h1>Done.</h1><p>You can close this tab and return to the terminal.</p></body></html>"
        );
        server.close();
        resolve(tokens);
      } catch (err) {
        try { res.writeHead(500).end(String(err)); } catch {}
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, () => {
      openInBrowser(authUrl);
    });
    server.on("error", reject);
  });

  if (!result.refresh_token) {
    console.error("\nNo refresh_token returned. This usually means the consent prompt was skipped.");
    console.error("Revoke prior access at https://myaccount.google.com/permissions and re-run.\n");
    process.exit(1);
  }

  console.log("\n=== Refresh token (paste into Vercel as GOOGLE_GROUPS_REFRESH_TOKEN) ===\n");
  console.log(result.refresh_token);
  console.log("\nScopes granted:", result.scope);
  console.log("Access token (short-lived, not needed):", result.access_token?.slice(0, 16) + "…");
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
