import { usePath } from './router.tsx';
import { Layout, type Section } from './ui/Layout.tsx';
import { CatalogPage } from './pages/Catalog.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { Soon } from './pages/Soon.tsx';

const PAGES: Record<string, [Section, () => React.JSX.Element]> = {
  '/': [
    'home',
    () => (
      <Soon title="Oggi" phase={4}>
        Qui vedrai i bonifici ancora da fare, le uscite dei prossimi quattordici giorni e i debiti scaduti. Intanto il
        catalogo e le impostazioni sono pronti.
      </Soon>
    ),
  ],
  '/calendario': [
    'cal',
    () => (
      <Soon title="Calendario" phase={5}>
        L’anno in dodici colonne, con spese, scadenze, compleanni e debiti.
      </Soon>
    ),
  ],
  '/catalogo': ['cat', CatalogPage],
  '/debiti': [
    'deb',
    () => (
      <Soon title="Debiti" phase={5}>
        I debiti da ricordare, con quelli scaduti in cima e “segna come saldato”.
      </Soon>
    ),
  ],
  '/storico': [
    'sto',
    () => (
      <Soon title="Storico" phase={4}>
        Le programmazioni confermate, da riaprire in sola lettura.
      </Soon>
    ),
  ],
  '/impostazioni': ['imp', SettingsPage],
};

export function App() {
  const path = usePath().replace(/\/+$/, '') || '/';
  const [section, Page] = PAGES[path] ?? [
    'home',
    () => (
      <Soon title="Pagina non trovata" phase={0}>
        Questa pagina non esiste.
      </Soon>
    ),
  ];
  return (
    <Layout active={section}>
      <Page />
    </Layout>
  );
}
