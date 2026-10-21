"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { MessageSquarePlus } from "lucide-react";

import { submitFeedback } from "@/app/admin-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { readableError } from "@/lib/action-error";

const types = ["Problem", "Idea", "Question"] as const;

/** "Send feedback" in the top bar: a problem, idea or question goes to the MIK LEDGER team with the page it came from. */
export default function FeedbackDialog() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof types)[number]>("Problem");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await submitFeedback(type, message, pathname);
      toast.success("Thank you! Your feedback reached the MIK LEDGER team.");
      setMessage("");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "It couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="icon" aria-label="Send feedback" title="Send feedback" className="shrink-0" onClick={() => setOpen(true)}>
        <MessageSquarePlus size={17} strokeWidth={1.8} />
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!sending) setOpen(next); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>Tell us what went wrong, what you&apos;d like, or ask a question. We read every message.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of feedback">
              {types.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={type === option} onClick={() => setType(option)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${type === option ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40"}`}>{option}</button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea id="feedback-message" rows={5} maxLength={3000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={type === "Problem" ? "What happened, and what did you expect?" : type === "Idea" ? "What would make MIK LEDGER better for you?" : "What would you like to know?"} />
              <p className="text-xs text-muted-foreground">We&apos;ll also see this page ({pathname}) and reply to your email.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={sending || message.trim().length < 3} onClick={() => void send()}>{sending ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
