import { hc, type InferResponseType } from 'hono/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { App } from '@kakebo/api';
import type {
  AccountCreate,
  AccountPatch,
  AccountRecord,
  CatalogImport,
  CatalogItem,
  ItemCreate,
  ItemPatch,
  Settings,
} from '@kakebo/core';

/** Typed client of our own API (same origin: Cloudflare Access sends its cookie). */
export const client = hc<App>('/', { init: { credentials: 'same-origin' } });

/** Error with the server's message (already in Italian). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function unwrap<T>(res: Promise<Response>): Promise<T> {
  let r: Response;
  try {
    r = await res;
  } catch {
    throw new ApiError(0, 'il servizio non risponde: controlla la connessione');
  }
  if (r.ok) return (await r.json()) as T;
  let message = `errore ${r.status}`;
  try {
    const body = (await r.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    /* not JSON */
  }
  if (r.status === 403) message = 'accesso scaduto: ricarica la pagina per rifare il login';
  throw new ApiError(r.status, message);
}

export type Catalog = InferResponseType<typeof client.api.catalog.$get>;
// The inferred type and the domain types must agree.
type _Check = Catalog extends { accounts: AccountRecord[]; items: CatalogItem[]; settings: Settings } ? true : never;
const _check: _Check = true;
void _check;

export const meQuery = () => ({
  queryKey: ['me'],
  queryFn: () => unwrap<{ id: string; kind: 'user' | 'service' | 'dev' }>(client.api.me.$get()),
});

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: () => unwrap<Catalog>(client.api.catalog.$get()) });
}

/** Mutations refresh the catalog when they succeed. */
function useCatalogMutation<V, R>(fn: (v: V) => Promise<Response>) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: (v) => unwrap<R>(fn(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog'] }),
  });
}

export const useCreateAccount = () =>
  useCatalogMutation<AccountCreate, AccountRecord>((json) => client.api.accounts.$post({ json }));
export const useUpdateAccount = () =>
  useCatalogMutation<{ id: string; patch: AccountPatch }, AccountRecord>(({ id, patch }) =>
    client.api.accounts[':id'].$patch({ param: { id }, json: patch }),
  );
export const useCreateItem = () =>
  useCatalogMutation<ItemCreate, CatalogItem>((json) => client.api.items.$post({ json }));
export const useUpdateItem = () =>
  useCatalogMutation<{ id: string; patch: ItemPatch }, CatalogItem>(({ id, patch }) =>
    client.api.items[':id'].$patch({ param: { id }, json: patch }),
  );
export const useUpdateSettings = () =>
  useCatalogMutation<Partial<Settings>, Settings>((json) => client.api.settings.$patch({ json }));
export const useImportCatalog = () =>
  useCatalogMutation<CatalogImport, { accounts: number; items: number }>((json) =>
    client.api.import.catalog.$post({ json }),
  );
