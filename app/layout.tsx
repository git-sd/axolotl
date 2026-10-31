import type { Metadata } from "next";
import "./globals.css";
import { nunito } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Axolotl: agent experience scanner",
  description: "Scores how well AI agents can find, navigate and complete tasks on a website, using TinyFish web agents, then ranks the fixes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={nunito.className}>
      <body>{children}</body>
    </html>
  );
}
