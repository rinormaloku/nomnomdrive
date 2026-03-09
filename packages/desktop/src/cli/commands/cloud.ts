import { Command } from 'commander';
import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';
import { AddressInfo } from 'net';
import { loadConfig, saveConfig, loadCloudCredentials, saveCloudCredentials, deleteCloudCredentials } from '@nomnomdrive/shared';
import { loginSuccessPage } from '../../login-success-page';

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const DEFAULT_SERVER_URL = 'https://cloud.nomnomdrive.com';

export function cloudCommand(): Command {
  const cloud = new Command('cloud').description('Manage NomNomDrive cloud connection');

  cloud.addCommand(loginCommand());
  cloud.addCommand(statusCommand());
  cloud.addCommand(logoutCommand());

  return cloud;
}

function loginCommand(): Command {
  return new Command('login')
    .description('Authenticate with NomNomDrive cloud via Google OAuth')
    .option('--server <url>', 'Cloud server URL', DEFAULT_SERVER_URL)
    .action(async (opts: { server: string }) => {
      const serverUrl = opts.server.replace(/\/$/, '');

      // Start a temporary local HTTP server to receive the OAuth callback
      let resolveCode: (code: string) => void;
      const codePromise = new Promise<string>((r) => { resolveCode = r; });

      const callbackServer = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`);
        const code = url.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(loginSuccessPage(serverUrl));
          resolveCode!(code);
        } else {
          res.writeHead(400).end('Missing code');
        }
      });

      await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
      const port = (callbackServer.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const { verifier: codeVerifier, challenge: codeChallenge } = generatePkce();

      // Register OAuth client dynamically (RFC 7591)
      const regResponse = await fetch(`${serverUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'NomNomDrive CLI',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      });
      if (!regResponse.ok) {
        const text = await regResponse.text();
        throw new Error(`Client registration failed: ${regResponse.status} ${text}`);
      }
      const { client_id: clientId } = await regResponse.json() as { client_id: string };

      const authorizeUrl =
        `${serverUrl}/auth/authorize` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=openid+profile+email` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256`;

      console.log('\nOpening browser for Google OAuth login...');
      console.log(`If the browser does not open, visit:\n  ${authorizeUrl}\n`);

      // Open browser
      const { spawn } = await import('child_process');
      const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(opener, [authorizeUrl], { detached: true, stdio: 'ignore' }).unref();

      // Wait for callback (60s timeout)
      const code = await Promise.race([
        codePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Login timed out (60s)')), 60_000),
        ),
      ]);

      callbackServer.close();

      // Exchange code for tokens
      const tokenResponse = await fetch(`${serverUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${text}`);
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      await saveCloudCredentials({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      });

      // Update config to cloud mode
      const config = await loadConfig();
      config.mode = 'cloud';
      config.cloud = { serverUrl };
      await saveConfig(config);

      console.log('✓ Logged in successfully. NomNomDrive will connect to the cloud on next start.');
    });
}

function statusCommand(): Command {
  return new Command('status')
    .description('Show cloud connection status')
    .action(async () => {
      const config = await loadConfig();
      const creds = await loadCloudCredentials();

      if (config.mode !== 'cloud' || !config.cloud?.serverUrl) {
        console.log('Mode: local (cloud not configured — run `nomnomdrive cloud login`)');
        return;
      }

      console.log(`Mode:       cloud`);
      console.log(`Server:     ${config.cloud.serverUrl}`);

      if (!creds?.accessToken) {
        console.log('Auth:       no credentials — run `nomnomdrive cloud login`');
        return;
      }

      // Check connectivity
      try {
        const res = await fetch(`${config.cloud.serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
        console.log(`Auth:       credentials saved`);
        console.log(`Reachable:  ${res.ok ? 'yes' : `no (HTTP ${res.status})`}`);
      } catch {
        console.log(`Auth:       credentials saved`);
        console.log(`Reachable:  no (server unreachable)`);
      }
    });
}

function logoutCommand(): Command {
  return new Command('logout')
    .description('Remove cloud credentials and switch back to local mode')
    .action(async () => {
      await deleteCloudCredentials();
      const config = await loadConfig();
      config.mode = 'local';
      await saveConfig(config);
      console.log('✓ Logged out. Switched back to local mode.');
    });
}

