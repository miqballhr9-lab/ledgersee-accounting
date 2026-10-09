import { cn } from "@/lib/utils";

interface BrandWordmarkProps {
  className?: string;
  size?: "default" | "compact";
}

export default function BrandWordmark({ className, size = "default" }: BrandWordmarkProps) {
  return (
    <span
      role="img"
      aria-label="MIK LEDGER"
      className={cn(
        "brand-wordmark relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-sidebar font-bold leading-none tracking-[0.02em] text-sidebar-foreground transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.02] group-focus-visible:-translate-y-0.5 group-focus-visible:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:translate-y-0 motion-reduce:group-focus-visible:scale-100",
        size === "compact" ? "h-9 px-2.5 text-sm" : "h-10 px-3.5 text-base",
        className,
      )}
    >
      <span aria-hidden="true">MIK LEDGER</span>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-1">
        <span className="w-1/3 bg-green-500" />
        <span className="w-1/3 bg-amber-400" />
        <span className="w-1/3 bg-red-500" />
      </span>
    </span>
  );
}
