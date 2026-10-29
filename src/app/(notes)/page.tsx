import type { Metadata } from "next";
import Navbar from "@/app/(notes)/navbar";
import NotesSearchList from "./notes-search-list";

export const metadata: Metadata = {
  title: "Monotes",
  description:
    "A modern, distraction-free note-taking application with markdown support, cloud synchronization, and a clean writing experience. Built for writers, developers, and anyone who values focused productivity.",
  keywords: [
    "note taking",
    "markdown editor",
    "distraction free writing",
    "cloud notes",
    "productivity app",
    "writing app",
  ],
  openGraph: {
    title: "Monotes - Modern Note Taking App",
    description:
      "A distraction-free note-taking application with markdown support and cloud sync.",
    type: "website",
  },
};

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-page text-text-1">
      <Navbar />
      <main className="mx-auto flex w-full max-w-224 flex-col gap-8 px-4 pt-20 pb-10">
        <header className="flex flex-col gap-2">
          <h1 className="type-title">Monotes</h1>
          <p className="max-w-measure type-body text-text-2">
            A modern, distraction-free note-taking app
          </p>
        </header>

        <NotesSearchList />

        <section className="flex flex-col gap-3 border-t border-line pt-8 [&>*]:max-w-measure">
          <h2 className="type-heading">About Monotes</h2>
          <p className="type-body text-text-2">
            Monotes is a modern, distraction-free note-taking application
            designed for writers, developers, and anyone who values a clean,
            focused writing experience. Built with Next.js and featuring
            real-time cloud synchronization, Monotes helps you capture your
            thoughts and ideas without getting in your way.
          </p>
          <h2 className="pt-3 type-heading">Features</h2>
          <ul className="flex list-inside list-disc flex-col gap-1 type-body text-text-2">
            <li>Markdown support for rich text formatting</li>
            <li>Distraction-free writing mode</li>
            <li>Cloud synchronization across devices</li>
            <li>Fast, local-first architecture</li>
            <li>Dark mode support</li>
            <li>Keyboard shortcuts and Vim mode</li>
          </ul>
          <p className="type-body text-text-2">
            Start taking notes today and experience a new way of capturing and
            organizing your ideas. Whether you&apos;re writing documentation,
            keeping a journal, or brainstorming, Monotes provides the tools
            you need to stay productive and focused.
          </p>
        </section>
      </main>
    </div>
  );
}
