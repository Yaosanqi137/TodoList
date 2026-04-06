import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";

type PlaceholderPageProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
};

export function PlaceholderPage({
  title,
  description,
  icon: Icon = Construction
}: PlaceholderPageProps) {
  return (
    <section className="rounded-[2rem] border border-border/70 bg-card/92 p-8 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-7" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
    </section>
  );
}
