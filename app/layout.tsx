import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceTheme } from "@/components/workspace-theme";

export const metadata: Metadata = {
  title: "Recharge | One standard, every stage",
  description: "The central Recharge workspace for internal teams and clients.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><WorkspaceTheme>{children}</WorkspaceTheme></body>
    </html>
  );
}
