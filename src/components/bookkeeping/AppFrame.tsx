"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  ChevronDown,
  ClipboardList,
  ContactRound,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  ListFilter,
  ListChecks,
  ListTree,
  Menu,
  Package,
  Percent,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Undo2,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { navigationGroups } from "@/lib/bookkeeping-config";
import { signOut } from "@/lib/auth-client";

interface AppFrameProps {
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}

const icons: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  FileCheck2,
  ClipboardList,
  Undo2,
  Repeat,
  ContactRound,
  Receipt,
  Wallet,
  ShoppingCart,
  Landmark,
  ArrowLeftRight,
  ListFilter,
  ListChecks,
  ListTree,
  BookOpenCheck,
  Percent,
  BarChart3,
  ShieldCheck,
  Settings,
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "LL";
}

export default function AppFrame({ userName, userEmail, children }: AppFrameProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const activeLabel = navigationGroups.flatMap((group) => group.items).find((item) => {
    const href = item.slug === "dashboard" ? "/app" : `/app/${item.slug}`;
    return pathname === href;
  })?.label ?? "Workspace";

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
      router.replace("/");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex h-dvh min-h-[560px] overflow-hidden bg-background text-foreground">
      {menuOpen ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-foreground/30 md:hidden" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[276px] shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out md:static md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[68px] items-center justify-between border-b border-sidebar-border px-5">
          <Link href="/app" className="brand-lockup flex min-w-0 items-center gap-3" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <BriefcaseBusiness size={18} strokeWidth={1.8} />
            </span>
            <span className="truncate text-[16px] font-semibold tracking-tight">MIKLEDGER</span>
          </Link>
          <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </Button>
        </div>

        <div className="mx-3 mt-4 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">Business workspace</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{userName || "My business"}</span>
            <ChevronDown size={14} className="shrink-0 text-sidebar-foreground/50" />
          </div>
        </div>

        <nav aria-label="Main navigation" className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-5">
          {navigationGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-sidebar-foreground/45">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const href = item.slug === "dashboard" ? "/app" : `/app/${item.slug}`;
                  const isActive = pathname === href;
                  const Icon = icons[item.icon] ?? FileText;
                  return (
                    <Link
                      key={item.slug}
                      href={href}
                      onClick={() => setMenuOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex min-h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors ${isActive ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                    >
                      <Icon size={16} strokeWidth={1.75} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-primary">{initials(userName || userEmail)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{userName || "Account owner"}</p>
              <p className="truncate text-xs text-sidebar-foreground/50">{userEmail}</p>
            </div>
            <Button variant="ghost" size="sm" className="px-2 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={handleSignOut} disabled={isSigningOut}>
              {isSigningOut ? "…" : "Sign out"}
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="-ml-2 md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
              <Menu size={19} />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-muted-foreground">MIKLEDGER / {activeLabel}</p>
              <p className="truncate text-sm font-semibold">{activeLabel}</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground">Business account</span>
            <span className="grid size-8 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">{initials(userName || userEmail)}</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
