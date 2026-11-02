import Link from "next/link";

/** "Made with MIK LEDGER" and the logo, under pages a business shares with the public. Hidden when printed. */
export default function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <p className={`flex justify-center print:hidden ${className}`}>
      <Link href="/" className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
        <img src="/icons/icon.svg" alt="" width={20} height={20} className="size-5 rounded-[22%]" />
        Made with <span className="font-semibold tracking-wide text-foreground">MIK LEDGER</span>
      </Link>
    </p>
  );
}
