import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { themeClass } from "@/lib/theme";
import { getTheme } from "@/lib/theme-server";

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
  title: { default: "Tasks App", template: "%s · Tasks App" },
  description:
    "Explora transcripciones de reuniones y crea incidencias en Linear a partir de ellas.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getTheme();

  return (
    // The theme class comes from the cookie and is already in the HTML the
    // server sends, so the first paint is the right one — no flash, and no
    // blocking script in the <head>. With "system" no class is set and the
    // `color-scheme` of globals.css hands the decision to the OS.
    // suppressHydrationWarning on both elements: browser extensions
    // (LanguageTool's data-lt-installed, Grammarly, dark-mode helpers) write
    // attributes into <html> and <body> before React hydrates, and React then
    // reports a mismatch for markup the app never produced. The flag on <html>
    // does not cover its child, so <body> needs its own. It only silences
    // attribute noise on these two elements — real mismatches inside the tree
    // are still reported.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${themeClass(theme)} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
