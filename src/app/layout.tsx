import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "yxuOS",
  description:
    "AI-powered development collaboration platform — onboarding, architecture, tasks, and design in one workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
        `suppressHydrationWarning` mirrors the one on <html> above. Browser
        extensions (ColorZilla's `cz-shortcut-listen`, Grammarly's
        `data-gr-*`, dark-reader, LastPass, …) routinely inject attributes
        on <body> before React hydrates, producing benign "server HTML
        didn't match client" warnings. We can't control extensions on
        users' machines, so we tell React to stop tripping on body-level
        attribute drift. This is React's officially recommended fix:
        https://react.dev/reference/react-dom/client/hydrateRoot#suppressing-unavoidable-hydration-mismatch-errors
      */}
      <body
        className="min-h-full flex flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
