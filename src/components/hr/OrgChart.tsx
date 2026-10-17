import Link from "next/link";

export interface OrgPerson {
  id: string;
  name: string;
  job: string;
  department: string;
  manager: string;
  photo: string;
}

const tones = ["bg-[#714B67]", "bg-[#017E84]", "bg-[#E46F78]", "bg-[#21B799]", "bg-[#5B899E]", "bg-[#E4A900]", "bg-[#8F5FD8]"];

function Avatar({ person }: { person: OrgPerson }) {
  if (person.photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={person.photo} alt="" className="size-10 shrink-0 rounded-md object-cover" />;
  }
  const tone = tones[[...person.name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length];
  const letters = person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return <span className={`grid size-10 shrink-0 place-items-center rounded-md text-sm font-semibold text-white ${tone}`}>{letters || "?"}</span>;
}

/** Odoo's organisation chart: each manager with the people who report to them. */
export default function OrgChart({ people }: { people: OrgPerson[] }) {
  const names = new Set(people.map((person) => person.name));
  const reports = (name: string) => people.filter((person) => person.manager === name && person.name !== name).sort((a, b) => a.name.localeCompare(b.name));
  const roots = people.filter((person) => !person.manager || !names.has(person.manager) || person.manager === person.name).sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();

  function branch(person: OrgPerson, depth: number): React.ReactNode {
    if (seen.has(person.id) || depth > 12) return null;
    seen.add(person.id);
    const team = reports(person.name);
    return (
      <li key={person.id} className="relative">
        <Link href={`/app/employees?open=${person.id}`} className="flex w-72 max-w-full items-center gap-3 rounded-lg border border-border bg-card p-2.5 shadow-xs hover:border-primary">
          <Avatar person={person} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{person.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{[person.job, person.department].filter(Boolean).join(" · ") || "Employee"}</span>
          </span>
          {team.length ? <span className="ml-auto rounded-full bg-muted px-2 text-xs text-muted-foreground" title="Direct reports">{team.length}</span> : null}
        </Link>
        {team.length ? <ul className="mt-2 space-y-2 border-l border-border pl-6">{team.map((member) => branch(member, depth + 1))}</ul> : null}
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7">
      <header className="border-b border-border pb-3">
        <h1 className="text-xl font-semibold">Org chart</h1>
        <p className="mt-1 text-sm text-muted-foreground">Who reports to whom, from each employee&apos;s Manager. Click a person to open them.</p>
      </header>
      {people.length ? <ul className="mt-5 space-y-3">{roots.map((person) => branch(person, 0))}</ul> : <p className="py-16 text-center text-sm text-muted-foreground">Add employees and their managers to see the chart.</p>}
    </div>
  );
}
