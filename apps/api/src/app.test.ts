import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import { CatalogStore, openDatabase } from '@kakebo/db';
import { createApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';

const TEAM = 'example.cloudflareaccess.com';
const AUD_WEB = 'aud-web';
const AUD_API = 'aud-api';

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

const config: Config = {
  port: 0,
  staticDir: null,
  dataDir: './data',
  migrationsDir: null,
  access: { teamDomain: TEAM, audiences: [AUD_WEB, AUD_API] },
  devFakeIdentity: null,
};

function sign(claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD_WEB)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(privateKey);
}

const get = (path: string, headers: Record<string, string> = {}) => createApp(config, { jwks, store: new CatalogStore(openDatabase({ file: ':memory:' }).db) }).request(path, { headers });

describe('Cloudflare Access middleware', () => {
  it('healthz is public', async () => {
    expect((await get('/healthz')).status).toBe(200);
  });

  it('rejects requests without a JWT with 403', async () => {
    expect((await get('/api/me')).status).toBe(403);
  });

  it('rejects a garbage token', async () => {
    expect((await get('/api/me', { 'cf-access-jwt-assertion': 'not-a-jwt' })).status).toBe(403);
  });

  it('rejects a JWT for another audience', async () => {
    const token = await sign({ email: 'a@example.com' }, { aud: 'someone-else' });
    expect((await get('/api/me', { 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('rejects a JWT from another issuer', async () => {
    const token = await sign({ email: 'a@example.com' }, { iss: 'https://evil.cloudflareaccess.com' });
    expect((await get('/api/me', { 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('rejects an expired JWT', async () => {
    const token = await sign({ email: 'a@example.com' }, { exp: '10 minutes ago' });
    expect((await get('/api/me', { 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('accepts a user JWT from the header', async () => {
    const token = await sign({ email: 'a@example.com' });
    const res = await get('/api/me', { 'cf-access-jwt-assertion': token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a@example.com', kind: 'user' });
  });

  it('accepts a service-token JWT (native apps) from the cookie', async () => {
    const token = await sign({ common_name: 'phone-1.access' }, { aud: AUD_API });
    const res = await get('/api/me', { cookie: `CF_Authorization=${token}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'phone-1.access', kind: 'service' });
  });
});

describe('config', () => {
  it('refuses to start with DEV_FAKE_IDENTITY in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_FAKE_IDENTITY: 'me@example.com' })).toThrow(/Refusing to start/);
  });

  it('refuses to start without Access configuration', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/not configured/);
  });

  it('allows a fake identity in development', () => {
    expect(loadConfig({ DEV_FAKE_IDENTITY: 'dev@example.com' }).devFakeIdentity).toBe('dev@example.com');
  });
});
