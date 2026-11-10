import type { ReactNode } from 'react';
import { Link } from '../router.tsx';
import { Seal, cx } from './kit.tsx';

export type Section = 'home' | 'cal' | 'cat' | 'deb' | 'sto' | 'imp';

const NAV: [Section, string, string][] = [
  ['home', 'Oggi', '/'],
  ['cal', 'Calendario', '/calendario'],
  ['cat', 'Catalogo', '/catalogo'],
  ['deb', 'Debiti', '/debiti'],
  ['sto', 'Storico', '/storico'],
  ['imp', 'Impostazioni', '/impostazioni'],
];

// On the phone Storico and Impostazioni live under "Altro".
const TABS: [Section[], string, string][] = [
  [['home'], 'Oggi', '/'],
  [['cal'], 'Anno', '/calendario'],
  [['cat'], 'Voci', '/catalogo'],
  [['deb'], 'Debiti', '/debiti'],
  [['imp', 'sto'], 'Altro', '/impostazioni'],
];

const PHONE_TITLE: Record<Section, string> = {
  home: 'kakebo',
  cal: 'L’anno',
  cat: 'Le voci',
  deb: 'Debiti',
  sto: 'Altro',
  imp: 'Altro',
};

export function Layout({ active, children }: { active: Section; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      {/* desktop header */}
      <header className="hidden flex-wrap items-end gap-x-8 gap-y-3.5 border-b-2 border-ink px-12 pt-[22px] md:flex">
        <Link href="/" className="flex items-center gap-3 pb-3 text-ink no-underline">
          <Seal />
          <span className="font-display text-[26px] font-extrabold">kakebo</span>
        </Link>
        <nav aria-label="Sezioni" className="flex flex-1 flex-wrap gap-0.5">
          {NAV.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              aria-current={key === active ? 'page' : undefined}
              className={cx(
                'rounded-t px-4 pt-3 pb-[11px] text-[15px] font-medium no-underline',
                key === active ? 'bg-inv text-inv-ink' : 'text-ink-2 hover:text-ink',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <span
          title="Arriva con la fase 4"
          aria-disabled="true"
          className="mb-2.5 inline-flex min-h-11 cursor-not-allowed items-center rounded-field border-[1.5px] border-rule px-[18px] text-[15px] font-bold text-ink-2"
        >
          Nuova programmazione
        </span>
      </header>

      {/* phone header */}
      <header className="flex items-center gap-2.5 border-b-2 border-ink px-4 pt-3.5 pb-3 md:hidden">
        <Seal size={32} />
        <span className="font-display text-[22px] font-extrabold">{PHONE_TITLE[active]}</span>
      </header>
      {(active === 'imp' || active === 'sto') && (
        <nav aria-label="Altre sezioni" className="flex gap-1.5 px-4 pt-3 md:hidden">
          {(
            [
              ['sto', 'Storico', '/storico'],
              ['imp', 'Impostazioni', '/impostazioni'],
            ] as const
          ).map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              aria-current={key === active ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-11 items-center rounded-[22px] px-3.5 text-sm no-underline',
                key === active ? 'bg-inv font-bold text-inv-ink' : 'border-[1.5px] border-rule text-ink',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      <main className="box-border w-full max-w-[1240px] flex-1 px-4 pt-5 pb-7 md:px-12 md:pt-[30px] md:pb-14">{children}</main>

      {/* phone tab bar */}
      <nav
        aria-label="Sezioni"
        className="sticky bottom-0 grid grid-cols-5 border-t-2 border-ink bg-paper md:hidden"
      >
        {TABS.map(([keys, label, href]) => {
          const cur = keys.includes(active);
          return (
            <Link
              key={label}
              href={href}
              aria-current={cur ? 'page' : undefined}
              className={cx(
                'flex min-h-[60px] flex-col items-center justify-center gap-[5px] text-[13px] no-underline',
                cur ? 'font-bold text-ink' : 'text-ink-2',
              )}
            >
              <span aria-hidden="true" className={cx('size-1.5 rounded-full', cur ? 'bg-verm' : 'bg-transparent')} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
