// Verify npm trusts this workflow without publishing a package or saving tokens.
import { readFile } from 'node:fs/promises';

try {
  const packages = process.argv.slice(2);
  if (!packages.length) packages.push(JSON.parse(await readFile('package.json', 'utf8')).name);
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error('GitHub OIDC credentials are unavailable; check id-token: write.');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', 'npm:registry.npmjs.org');
  const identity = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!identity.ok) throw new Error(`GitHub OIDC request failed: HTTP ${identity.status}`);
  const { value } = await identity.json();
  if (!value) throw new Error('GitHub returned no OIDC identity token.');
  for (const name of packages) {
    const exchange = await fetch(`https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!exchange.ok) throw new Error(`npm trust verification failed for ${name}: HTTP ${exchange.status}`);
    const result = await exchange.json();
    if (!result.token) throw new Error(`npm returned no publishing token for ${name}.`);
    console.log(`Verified npm trusted publishing for ${name}. No package was published.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
