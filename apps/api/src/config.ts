export interface Config {
  port: number;
  /** Directory with the built web app; null = API only. */
  staticDir: string | null;
  dataDir: string;
  access: {
    /** e.g. "myteam.cloudflareaccess.com" */
    teamDomain: string;
    /** AUD tags of the two Access applications (web + native apps). */
    audiences: string[];
  } | null;
  /** Local development only: identity used instead of a Cloudflare Access JWT. */
  devFakeIdentity: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const devFakeIdentity = env.DEV_FAKE_IDENTITY?.trim() || null;

  if (devFakeIdentity && production) {
    throw new Error('DEV_FAKE_IDENTITY must never be set when NODE_ENV=production. Refusing to start.');
  }

  const teamDomain =
    env.CF_ACCESS_TEAM_DOMAIN?.trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '') || '';
  const audiences = [env.CF_ACCESS_AUD_WEB, env.CF_ACCESS_AUD_API]
    .map((a) => a?.trim())
    .filter((a): a is string => !!a);

  let access: Config['access'] = null;
  if (teamDomain && audiences.length > 0) {
    access = { teamDomain, audiences };
  } else if (!devFakeIdentity) {
    throw new Error(
      'Cloudflare Access is not configured: set CF_ACCESS_TEAM_DOMAIN and at least one of ' +
        'CF_ACCESS_AUD_WEB / CF_ACCESS_AUD_API' +
        (production ? '.' : ' (or DEV_FAKE_IDENTITY for local development).'),
    );
  }

  return {
    port: Number(env.PORT ?? 8080),
    staticDir: env.STATIC_DIR?.trim() || null,
    dataDir: env.DATA_DIR?.trim() || './data',
    access,
    devFakeIdentity,
  };
}
