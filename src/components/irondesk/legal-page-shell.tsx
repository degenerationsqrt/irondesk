import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function LegalPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="grid-fade min-h-screen bg-background px-4 py-8 sm:py-12">
      <article className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <Link
            to="/auth"
            search={{}}
            className="font-display text-2xl font-extrabold uppercase tracking-[0.18em]"
          >
            Iron<span className="text-primary">Desk</span>
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </header>
        <div className="panel space-y-6 p-5 text-sm leading-6 sm:p-8 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
        <footer className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <Link to="/privacy">Privacy</Link>
          <Link to="/account-deletion">Delete an account</Link>
          <Link to="/health-connect">Android Health setup</Link>
          <a href="https://github.com/degenerationsqrt/irondesk">IronDesk on GitHub</a>
        </footer>
      </article>
    </main>
  );
}
