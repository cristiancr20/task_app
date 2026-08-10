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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${themeClass(theme)} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
