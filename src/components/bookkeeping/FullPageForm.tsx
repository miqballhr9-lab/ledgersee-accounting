"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface FullPageFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: string;
  children: ReactNode;
  /** The dark action bar along the bottom, as on QuickBooks transaction forms. */
  footer: ReactNode;
}

/** The full-page shell QuickBooks uses for transactions such as Receive payment and Pay bills. */
export default function FullPageForm({ open, onOpenChange, title, description, children, footer }: FullPageFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="truncate text-xl font-semibold">{title}</DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}><X size={20} /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6">{children}</div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 bg-sidebar px-4 py-3 text-sidebar-foreground sm:px-6">{footer}</footer>
      </DialogContent>
    </Dialog>
  );
}

/** Secondary buttons on the dark footer. */
export const footerGhost = "text-sidebar-foreground hover:bg-white/10 hover:text-white";
