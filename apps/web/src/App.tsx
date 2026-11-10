import { usePath } from './router.tsx';
import { Layout, type Section } from './ui/Layout.tsx';
import { CatalogPage } from './pages/Catalog.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { HomePage } from './pages/Home.tsx';
import { CycleDetailPage, HistoryPage } from './pages/History.tsx';
import { PlanPage } from './pages/Plan.tsx';
import { Soon } from './pages/Soon.tsx';

const PAGES: Record<string, [Section, () => React.JSX.Element]> = {
  '/': ['home', HomePage],
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
  '/storico': ['sto', HistoryPage],
  '/impostazioni': ['imp', SettingsPage],
};

export function App() {
  const path = usePath().replace(/\/+$/, '') || '/';
  // The planning has its own header and no navigation: five minutes of focus.
  if (path === '/programmazione') return <PlanPage />;
  const cycle = /^\/storico\/(\d{4}-\d{2})$/.exec(path);
  if (cycle)
    return (
      <Layout active="sto">
        <CycleDetailPage month={cycle[1]!} />
      </Layout>
    );
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
