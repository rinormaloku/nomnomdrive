import { loadCloudCredentials, saveCloudCredentials } from '@nomnomdrive/shared';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Exchange the stored refresh token for a fresh access token, persist the new
 * credentials, and return the new access token.
 *
 * Returns null if refresh is impossible (no refresh token / client_id saved) or the
 * server rejects the request. The caller decides what to do on null (typically: give
 * up and prompt the user to re-login).
 */
export async function refreshAccessToken(serverUrl: string): Promise<string | null> {
  const creds = await loadCloudCredentials();
  if (!creds?.refreshToken || !creds.clientId) return null;

  const base = serverUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
      }).toString(),
    });
    if (!res.ok) {
      console.error(`[CloudAuth] Token refresh rejected: HTTP ${res.status}`);
      return null;
    }

    const tokens = (await res.json()) as TokenResponse;
    await saveCloudCredentials({
      accessToken: tokens.access_token,
      // Some servers rotate the refresh token; fall back to the existing one if not.
      refreshToken: tokens.refresh_token ?? creds.refreshToken,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      clientId: creds.clientId,
    });
    return tokens.access_token;
  } catch (err) {
    console.error('[CloudAuth] Token refresh failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
