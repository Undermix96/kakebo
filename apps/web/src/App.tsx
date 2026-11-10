import { useQuery } from '@tanstack/react-query';

interface Identity {
  id: string;
  kind: 'user' | 'service' | 'dev';
}

async function fetchMe(): Promise<Identity> {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The kakebo seal: 家計簿 written vertically on a vermilion hanko. */
function Seal({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-seal bg-verm font-display font-extrabold leading-none text-seal-ink [writing-mode:vertical-rl]"
      style={{ width: size, height: size, fontSize: size * 0.275 }}
    >
      家計簿
    </span>
  );
}

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="flex items-center gap-3 border-b-2 border-ink px-4 py-4 sm:px-12">
        <Seal />
        <span className="font-display text-[26px] font-extrabold">kakebo</span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-12">
        <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">Il quaderno è aperto.</h1>
        <p className="mt-4 max-w-prose text-lg leading-relaxed">
          Le fondamenta ci sono: il container risponde, l’accesso passa da Cloudflare. Le pagine del rito
          mensile arrivano nelle prossime fasi.
        </p>

        <div className="mt-10 border-t border-ink pt-3">
          <div className="text-sm text-ink-2">chi sta scrivendo</div>
          <div className="mt-1 font-mono text-xl font-semibold">
            {me.isPending && 'un attimo…'}
            {me.isError && 'non riesco a capire chi sei'}
            {me.isSuccess && me.data.id}
          </div>
        </div>

        <p className="mt-8 -rotate-1 font-hand text-2xl text-verm">prima il motore, poi le pagine.</p>
      </main>
    </div>
  );
}
