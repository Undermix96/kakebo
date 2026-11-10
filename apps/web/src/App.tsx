import { usePath } from './router.tsx';
import { Layout, type Section } from './ui/Layout.tsx';
import { CatalogPage } from './pages/Catalog.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { HomePage } from './pages/Home.tsx';
import { CycleDetailPage, HistoryPage } from './pages/History.tsx';
import { PlanPage } from './pages/Plan.tsx';
import { Soon } from './pages/Soon.tsx';
import { CalendarPage } from './pages/Calendar.tsx';
import { DebtsPage } from './pages/Debts.tsx';

const PAGES: Record<string, [Section, () => React.JSX.Element]> = {
  '/': ['home', HomePage],
  '/calendario': ['cal', CalendarPage],
  '/catalogo': ['cat', CatalogPage],
  '/debiti': ['deb', DebtsPage],
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
