import { OAuth2Client, type Credentials } from 'google-auth-library';
import type { Config } from '../config.js';

export interface DiscoveredLocation {
  resourceName: string;
  locationId: string;
  displayName: string;
  category: string;
  verified: boolean;
}

export interface DiscoveredAccount {
  resourceName: string;
  accountId: string;
  displayName: string;
  locations: DiscoveredLocation[];
}

interface GoogleAccount { name: string; accountName?: string; type?: string }
interface GoogleLocation {
  name: string;
  title?: string;
  categories?: { primaryCategory?: { displayName?: string; name?: string } };
  metadata?: { hasVoiceOfMerchant?: boolean };
}

export function googleResourceId(name: string, kind: 'accounts' | 'locations') {
  const match = name.match(new RegExp(`(?:^|/)${kind}/([^/]+)$`));
  if (!match?.[1]) throw new Error(`Invalid Google ${kind} resource name: ${name}`);
  return match[1];
}

async function authorizedJson<T>(client: OAuth2Client, url: URL): Promise<T> {
  const headers = await client.getRequestHeaders(url.toString());
  const response = await fetch(url, { headers: Object.fromEntries(headers) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google discovery failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function discoverGoogleBusinesses(config: Config, credentials: Credentials): Promise<DiscoveredAccount[]> {
  const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_BUSINESS_REDIRECT_URI);
  client.setCredentials(credentials);
  const accounts: GoogleAccount[] = [];
  let accountToken: string | undefined;
  do {
    const url = new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
    if (accountToken) url.searchParams.set('pageToken', accountToken);
    const page = await authorizedJson<{ accounts?: GoogleAccount[]; nextPageToken?: string }>(client, url);
    accounts.push(...(page.accounts ?? [])); accountToken = page.nextPageToken;
  } while (accountToken);

  const discovered: DiscoveredAccount[] = [];
  for (const account of accounts) {
    const accountId = googleResourceId(account.name, 'accounts');
    const locations: DiscoveredLocation[] = [];
    let locationToken: string | undefined;
    do {
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(accountId)}/locations`);
      url.searchParams.set('readMask', 'name,title,categories,metadata');
      url.searchParams.set('pageSize', '100');
      if (locationToken) url.searchParams.set('pageToken', locationToken);
      const page = await authorizedJson<{ locations?: GoogleLocation[]; nextPageToken?: string }>(client, url);
      for (const location of page.locations ?? []) locations.push({
        resourceName: location.name,
        locationId: googleResourceId(location.name, 'locations'),
        displayName: location.title?.trim() || 'Google Business Profile',
        category: location.categories?.primaryCategory?.displayName?.trim() || location.categories?.primaryCategory?.name?.trim() || 'עסק',
        verified: Boolean(location.metadata?.hasVoiceOfMerchant),
      });
      locationToken = page.nextPageToken;
    } while (locationToken);
    discovered.push({ resourceName: account.name, accountId, displayName: account.accountName?.trim() || account.name, locations });
  }
  return discovered;
}
