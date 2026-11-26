import type { ReactNode } from "react";

export const characterSectionClassName =
  "flex flex-col gap-3 border-b py-5 first:pt-1 last:border-b-0";

export function CharacterDetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={characterSectionClassName}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}
