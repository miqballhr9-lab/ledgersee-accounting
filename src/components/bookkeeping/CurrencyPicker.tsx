"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currencyOptions, getCurrencyOption } from "@/lib/currencies";

interface CurrencyPickerProps {
  id: string;
  value: string;
  required?: boolean;
  onValueChange: (value: string) => void;
}

export function CurrencyPicker({ id, value, required = false, onValueChange }: CurrencyPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedCurrency = getCurrencyOption(value);
  const hasSavedCurrency = Boolean(value && !selectedCurrency);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-required={required}
            className="w-full justify-between bg-background font-normal"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {value ? (
            <>
              <span className="font-medium">{value}</span>
              <span className="text-muted-foreground"> · {selectedCurrency?.name ?? "Saved currency"}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Choose a currency</span>
          )}
        </span>
        <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(25rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search currency or code…" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            {hasSavedCurrency ? (
              <CommandGroup heading="Saved currency">
                <CommandItem
                  value={`${value} saved currency`}
                  onSelect={() => {
                    onValueChange(value);
                    setOpen(false);
                  }}
                >
                  <span className="w-12 shrink-0 font-medium">{value}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">Saved currency</span>
                  <Check size={16} className="opacity-100" />
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Currencies">
              {currencyOptions.map((currency) => (
                <CommandItem
                  key={currency.code}
                  value={`${currency.code} ${currency.name}`}
                  onSelect={() => {
                    onValueChange(currency.code);
                    setOpen(false);
                  }}
                >
                  <span className="w-12 shrink-0 font-medium">{currency.code}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{currency.name}</span>
                  <Check size={16} className={value === currency.code ? "opacity-100" : "opacity-0"} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
