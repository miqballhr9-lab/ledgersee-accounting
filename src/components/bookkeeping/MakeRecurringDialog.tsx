"use client";

import { useState } from "react";
import { toast } from "sonner";

import { saveBookkeepingRecord } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { recurringKindLabels, templatePayload, type RecurringKind } from "@/lib/recurring";

interface MakeRecurringDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: RecurringKind;
  /** The transaction's fields, for a new template. */
  payload?: Record<string, string>;
  /** An existing template, to change its schedule. */
  template?: BookkeepingRecord | null;
  defaultName?: string;
  onSaved?: (template: BookkeepingRecord) => void;
}

const typeHelp: Record<string, string> = {
  Scheduled: "Created on each date. In Automation mode it happens on its own; otherwise it waits in Recurring transactions for you to create it.",
  Reminder: "Shows as due in Recurring transactions on each date, for you to review and create.",
  Unscheduled: "No schedule. Use the template whenever you need it.",
};

/** "Make recurring", as in QuickBooks: saves a transaction as a template that repeats on a schedule. */
export default function MakeRecurringDialog({ open, onOpenChange, kind, payload, template, defaultName = "", onSaved }: MakeRecurringDialogProps) {
  const today = new Date().toISOString().slice(0, 10);
  const saved = template?.data ?? {};
  const [name, setName] = useState(saved.rtName || defaultName);
  const [type, setType] = useState(saved.rtType || "Scheduled");
  const [interval, setIntervalValue] = useState(saved.rtInterval || "Monthly");
  const [every, setEvery] = useState(saved.rtEvery || "1");
  const [start, setStart] = useState(saved.rtNext || saved.rtStart || today);
  const [endType, setEndType] = useState(saved.rtEndType || "None");
  const [endDate, setEndDate] = useState(saved.rtEndDate || "");
  const [occurrences, setOccurrences] = useState(saved.rtOccurrences || "12");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const label = recurringKindLabels[kind];

  async function save() {
    setError("");
    setPending(true);
    try {
      const fields = template ? templatePayload(template.data) : payload ?? {};
      const result = await saveBookkeepingRecord("recurring-transactions", {
        ...fields,
        rtName: name,
        rtKind: kind,
        rtType: type,
        rtInterval: interval,
        rtEvery: every,
        rtStart: start,
        rtNext: start,
        rtEndType: endType,
        rtEndDate: endType === "By" ? endDate : "",
        rtOccurrences: endType === "After" ? occurrences : "",
        rtCount: saved.rtCount || "0",
        rtLast: saved.rtLast || "",
        rtStatus: saved.rtStatus === "Paused" ? "Paused" : "Active",
      }, template?.id);
      toast.success(template ? "Recurring schedule updated." : `Recurring ${label.toLowerCase()} template saved.`, { position: "top-center" });
      onSaved?.(result);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? readableError(saveError) : "We couldn’t save this template. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Edit recurring schedule" : `Make recurring ${label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>Save this {label.toLowerCase()} as a template that repeats. Find it later in Recurring transactions.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="recurring-name">Template name <span className="text-destructive">*</span></Label>
            <Input id="recurring-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="recurring-type">Type</Label>
            <Select value={type} onValueChange={(next) => setType(next ?? "Scheduled")}>
              <SelectTrigger id="recurring-type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Scheduled", "Reminder", "Unscheduled"].map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">{typeHelp[type]}</p>
          </div>
          {type !== "Unscheduled" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="recurring-interval">Interval</Label>
                <Select value={interval} onValueChange={(next) => setIntervalValue(next ?? "Monthly")}>
                  <SelectTrigger id="recurring-interval" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Daily", "Weekly", "Monthly", "Yearly"].map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recurring-every">Every</Label>
                <div className="flex items-center gap-2">
                  <Input id="recurring-every" type="number" min="1" max="99" value={every} onChange={(event) => setEvery(event.target.value)} className="w-20" />
                  <span className="text-sm text-muted-foreground">{{ Daily: "day(s)", Weekly: "week(s)", Monthly: "month(s)", Yearly: "year(s)" }[interval]}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recurring-start">{template ? "Next date" : "Start date"}</Label>
                <Input id="recurring-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recurring-end">End</Label>
                <Select value={endType} onValueChange={(next) => setEndType(next ?? "None")}>
                  <SelectTrigger id="recurring-end" className="w-full"><SelectValue>{{ None: "None", By: "By a date", After: "After a number of times" }[endType]}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="None">None</SelectItem>
                    <SelectItem value="By">By a date</SelectItem>
                    <SelectItem value="After">After a number of times</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {endType === "By" ? (
                <div className="space-y-2">
                  <Label htmlFor="recurring-end-date">End date</Label>
                  <Input id="recurring-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </div>
              ) : null}
              {endType === "After" ? (
                <div className="space-y-2">
                  <Label htmlFor="recurring-occurrences">Occurrences</Label>
                  <Input id="recurring-occurrences" type="number" min="1" max="999" value={occurrences} onChange={(event) => setOccurrences(event.target.value)} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={pending}>{pending ? "Saving…" : "Save template"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
