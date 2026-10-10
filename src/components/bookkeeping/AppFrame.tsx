"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpenCheck,
  Building2,
  ChevronDown,
  ClipboardList,
  ContactRound,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ListFilter,
  ListTree,
  LogOut,
  Menu,
  Package,
  Percent,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Undo2,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import BrandWordmark from "@/components/brand/BrandWordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  Banknote,
  ShieldCheck,
  Settings,
};

const gearGroups = [
  {
    label: "Company & lists",
    items: [
      { label: "Company settings", href: "/app/settings", icon: Building2 },
      { label: "Customers", href: "/app/customers", icon: Users },
      { label: "Vendors", href: "/app/vendors", icon: ContactRound },
      { label: "Items & services", href: "/app/items", icon: Package },
      { label: "Users & roles", href: "/app/team-members", icon: ShieldCheck },
    ],
  },
  {
    label: "Accounting tools",
    items: [
      { label: "Banking", href: "/app/bank-accounts", icon: Landmark },
      { label: "Transactions", href: "/app/transactions", icon: ArrowLeftRight },
      { label: "Reconciliation", href: "/app/reconciliation", icon: ListChecks },
      { label: "Bank rules", href: "/app/bank-rules", icon: ListFilter },
      { label: "Chart of accounts", href: "/app/accounts", icon: ListTree },
      { label: "Manual journals", href: "/app/journals", icon: BookOpenCheck },
      { label: "Taxes", href: "/app/taxes", icon: Percent },
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
    ],
  },
];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "LL";
}

export default function AppFrame({ userName, userEmail, children }: AppFrameProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(() =>
    navigationGroups.find((group) => group.items.some((item) => {
      const href = item.slug === "dashboard" ? "/app" : `/app/${item.slug}`;
      return pathname === href || pathname.startsWith(`${href}/`);
    }))?.label ?? "Overview"
  );
  const activeLabel = navigationGroups.flatMap((group) => group.items).find((item) => {
    const href = item.slug === "dashboard" ? "/app" : `/app/${item.slug}`;
    return pathname === href;
  })?.label ?? (pathname === "/app/profile" ? "Profile & privacy" : "Workspace");

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

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(pathname === "/app" ? "/" : "/app");
    }
  }

  return (
    <div className="flex h-dvh min-h-[560px] overflow-hidden bg-background text-foreground">
      {menuOpen ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-foreground/30 md:hidden" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[276px] shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out md:static md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[68px] items-center justify-between border-b border-sidebar-border px-5">
          <Link href="/app" className="brand-lockup group flex min-w-0 items-center" onClick={() => setMenuOpen(false)}>
            <BrandWordmark />
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

        <nav aria-label="Main navigation" className="mt-4 flex-1 space-y-2 overflow-y-auto px-3 pb-5">
          {navigationGroups.map((group) => {
            const isOpen = openGroup === group.label;
            return (
              <Collapsible
                key={group.label}
                open={isOpen}
                onOpenChange={(open) => setOpenGroup(open ? group.label : null)}
                className="space-y-1"
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <span>{group.label}</span>
                  <ChevronDown size={14} className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-0.5">
                  {group.items.map((item) => {
                    const href = item.slug === "dashboard" ? "/app" : `/app/${item.slug}`;
                    const isActive = pathname === href || pathname.startsWith(`${href}/`);
                    const Icon = icons[item.icon] ?? FileText;
                    return (
                      <Link
                        key={item.slug}
                        href={href}
                        onClick={() => {
                          setOpenGroup(group.label);
                          setMenuOpen(false);
                        }}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex min-h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors ${isActive ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                      >
                        <Icon size={16} strokeWidth={1.75} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
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
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={handleBack} aria-label="Go back" title="Go back">
              <ArrowLeft size={19} strokeWidth={1.75} />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-muted-foreground">MIK LEDGER / {activeLabel}</p>
              <p className="truncate text-sm font-semibold">{activeLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">Business account</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Open settings and tools" title="Settings and tools" className="shrink-0" />}>
                <Settings size={17} strokeWidth={1.8} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="max-h-[calc(100dvh-6rem)] w-[min(94vw,48rem)] overflow-y-auto p-4">
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {gearGroups.map((group) => (
                    <DropdownMenuGroup key={group.label}>
                      <DropdownMenuLabel className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.label}</DropdownMenuLabel>
                      <div className="space-y-1">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <DropdownMenuItem key={item.href} render={<Link href={item.href} />} className="min-h-10 gap-3 px-2.5 text-[13px]">
                              <Icon size={16} strokeWidth={1.7} className="text-primary" />
                              <span>{item.label}</span>
                            </DropdownMenuItem>
                          );
                        })}
                      </div>
                    </DropdownMenuGroup>
                  ))}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Profile & privacy</DropdownMenuLabel>
                    <div className="mb-2 rounded-md border border-border bg-background px-3 py-2.5">
                      <p className="truncate text-sm font-medium">{userName || "Account owner"}</p>
                      <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                    </div>
                    <div className="space-y-1">
                      <DropdownMenuItem render={<Link href="/app/profile" />} className="min-h-10 gap-3 px-2.5 text-[13px]">
                        <UserRound size={16} strokeWidth={1.7} className="text-primary" />
                        <span>Profile & privacy</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleSignOut()} disabled={isSigningOut} className="min-h-10 gap-3 px-2.5 text-[13px]">
                        <LogOut size={16} strokeWidth={1.7} />
                        <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
                      </DropdownMenuItem>
                    </div>
                  </DropdownMenuGroup>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">{initials(userName || userEmail)}</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
