import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { AccountColor, AccountShape } from '@kakebo/core';

/** Small building blocks of the "quaderno" look. Colors only through theme tokens. */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** The kakebo seal: 家計簿 written vertically on a vermilion hanko. */
export function Seal({ size = 40 }: { size?: number }) {
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

const SHAPE_CLASS: Record<AccountShape, string> = {
  square: 'size-[11px]',
  diamond: 'size-[10px] rotate-45',
  circle: 'size-3 rounded-full',
  bar: 'h-[7px] w-4 rounded-[2px]',
};

export const accountColor = (color: AccountColor) => `var(--k-acc-${color})`;

/** Each account has a color and a shape, so it reads without color too. */
export function AccountGlyph({ color, shape }: { color: AccountColor; shape: AccountShape }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block flex-none', SHAPE_CLASS[shape])}
      style={{ background: accountColor(color) }}
    />
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'quiet' | 'danger' | 'dashed' };

export function Button({ variant = 'outline', className, type = 'button', ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-field px-4 font-sans text-[15px] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'border-none bg-inv font-bold text-inv-ink',
        variant === 'outline' && 'border-[1.5px] border-ink bg-transparent text-ink',
        variant === 'quiet' && 'border border-rule bg-transparent text-[13.5px] text-ink',
        variant === 'dashed' && 'border border-dashed border-ink-2 bg-transparent text-sm text-ink',
        variant === 'danger' && 'border-none bg-transparent px-3 text-sm text-verm underline',
        className,
      )}
      {...rest}
    />
  );
}

/** A segmented control (one choice among a few). */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit flex-wrap overflow-hidden rounded-field border-[1.5px] border-ink">
      {options.map(([v, text], i) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cx(
            'cursor-pointer border-none px-3.5 font-sans',
            size === 'sm' ? 'min-h-10 text-[13.5px]' : 'min-h-11 text-[14.5px]',
            i > 0 && 'border-l border-l-rule',
            v === value ? 'bg-inv text-inv-ink' : 'bg-transparent text-ink',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Underlined field with a small label above, as in the design. */
export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1 text-xs text-ink-2', className)}>
      {label}
      {children}
    </label>
  );
}

export const inputClass =
  'h-11 w-full min-w-0 border-0 border-b-[1.5px] border-ink bg-transparent px-0 text-[17px] text-ink outline-offset-2 placeholder:text-ink-2/60';
export const monoInputClass = cx(inputClass, 'font-mono');

/** Handwritten note in vermilion (reminders, hints). */
export function Hand({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-hand text-[17px] leading-[1.1] text-verm', className)}>{children}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="m-0 flex items-start gap-2 text-sm text-verm">
      <span aria-hidden="true" className="grid size-5 flex-none place-items-center rounded-full border-[1.5px] border-verm font-display text-xs font-extrabold">
        !
      </span>
      {msg}
    </p>
  );
}

/** Loading state: rules traced from left to right, like a pen on the ledger. */
export function Loading({ label = 'sto ricopiando i conti…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="py-8">
      <div className="font-hand text-2xl text-ink-2">{label}</div>
      <div aria-hidden="true" className="mt-4 flex flex-col">
        {[70, 55, 80, 45, 65, 50].map((w, i) => (
          <div key={i} className="grid h-[34px] grid-cols-[60px_minmax(0,1fr)_90px] items-center gap-x-3.5 border-b border-rule">
            <span className="h-2 origin-left animate-pulse bg-rule" />
            <span className="h-2 origin-left animate-pulse bg-rule" style={{ width: `${w}%` }} />
            <span className="h-2 origin-left animate-pulse bg-rule" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="m-0 font-display text-[34px] leading-none font-bold sm:text-5xl">{children}</h1>
      {sub && <p className="mt-2 mb-0 max-w-[60ch] text-[15px] leading-normal text-ink-2">{sub}</p>}
    </div>
  );
}
