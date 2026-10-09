"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function InvoicePrintButton() {
  return <Button type="button" onClick={() => window.print()}><Printer size={15} />Print or save PDF</Button>;
}
