"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

export interface Solution {
  id: string;
  tab: string;
  title: string;
  text: string;
  points: string[];
  figure: { label: string; value: string; note: string }[];
}

/** "Explore solutions": one tab per area of the business, each with what it does and a small picture of it. */
export default function SolutionTabs({ solutions, start, startLabel }: { solutions: Solution[]; start: string; startLabel: string }) {
  const [active, setActive] = useState(solutions[0]?.id ?? "");
  const current = solutions.find((solution) => solution.id === active) ?? solutions[0];
  if (!current) return null;
  return (
    <div>
      <div role="tablist" aria-label="Solutions" className="-mx-4 flex gap-1 overflow-x-auto border-b border-black/10 px-4 sm:mx-0 sm:px-0">
        {solutions.map((solution) => (
          <button
            key={solution.id}
            type="button"
            role="tab"
            id={`tab-${solution.id}`}
            aria-selected={solution.id === current.id}
            aria-controls={`panel-${solution.id}`}
            onClick={() => setActive(solution.id)}
            className={`shrink-0 border-b-[3px] px-4 py-3 text-[15px] font-semibold transition-colors ${solution.id === current.id ? "border-[oklch(0.49_0.105_238)] text-[oklch(0.49_0.105_238)]" : "border-transparent text-black/60 hover:text-black"}`}
          >
            {solution.tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} className="grid items-center gap-10 py-10 lg:grid-cols-2">
        <div>
          <h3 className="text-3xl font-bold tracking-tight">{current.title}</h3>
          <p className="mt-4 text-lg leading-8 text-black/65">{current.text}</p>
          <ul className="mt-5 space-y-2">
            {current.points.map((point) => <li key={point} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-[oklch(0.5_0.12_160)]" />{point}</li>)}
          </ul>
          <Link href={start} className="mt-7 inline-flex h-11 items-center gap-2 rounded-md bg-[oklch(0.49_0.105_238)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[oklch(0.43_0.105_238)]">{startLabel} <ArrowRight size={16} /></Link>
        </div>
        <div className="grid gap-3 rounded-2xl bg-[oklch(0.975_0.008_230)] p-5 sm:grid-cols-3 sm:p-6" aria-hidden="true">
          {current.figure.map((item) => (
            <div key={item.label} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-black/55">{item.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{item.value}</p>
              <p className="mt-1 text-xs text-[oklch(0.5_0.12_160)]">{item.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
