import { PageTitle } from '../ui/kit.tsx';

/** Pages that arrive in later phases. */
export function Soon({ title, phase, children }: { title: string; phase: number; children: string }) {
  return (
    <div className="max-w-3xl">
      <PageTitle>{title}</PageTitle>
      <p className="mt-4 max-w-prose text-lg leading-relaxed">{children}</p>
      <p className="mt-8 -rotate-1 font-hand text-2xl text-verm">arriva con la fase {phase}.</p>
    </div>
  );
}
