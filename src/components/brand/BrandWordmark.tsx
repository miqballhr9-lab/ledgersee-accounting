import { cn } from "@/lib/utils";

interface BrandWordmarkProps {
  className?: string;
  size?: "default" | "compact";
}

/** The MIK LEDGER logo: the app icon (the same one the phone app installs with) beside the full wordmark. */
export default function BrandWordmark({ className, size = "default" }: BrandWordmarkProps) {
  const compact = size === "compact";
  return (
    <span role="img" aria-label="MIK LEDGER" className={cn("inline-flex shrink-0 items-center gap-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here */}
      <img
        src="/icons/icon.svg"
        alt=""
        aria-hidden="true"
        width={compact ? 36 : 40}
        height={compact ? 36 : 40}
        className={cn(
          "shrink-0 rounded-[22%] shadow-sm transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.04] group-focus-visible:-translate-y-0.5 group-focus-visible:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100",
          compact ? "size-9" : "size-10",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "brand-wordmark relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-sidebar font-bold leading-none tracking-[0.02em] text-sidebar-foreground transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.02] group-focus-visible:-translate-y-0.5 group-focus-visible:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:translate-y-0 motion-reduce:group-focus-visible:scale-100",
          compact ? "h-9 px-2.5 text-sm" : "h-10 px-3.5 text-base",
        )}
      >
        MIK LEDGER
      </span>
    </span>
  );
}
