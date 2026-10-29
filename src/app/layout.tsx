import React from "react";
import type { Metadata } from "next";
import "@/components/sodium/styles.css";
import "./globals.css";
import { ConvexClientProvider } from "./convex-context-provider";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { Toaster } from "@/components/sodium/ui/toast";
import { SodiumPortalProvider } from "@/lib/sodium/portal";
import { ThemeProvider } from "@/components/theme-provider";
import { EditorSettingsProvider } from "@/contexts/editor-settings-context";

export const metadata: Metadata = {
  title: "Monotes",
  description: "A modern note-taking application built with Next.js and Convex",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" suppressHydrationWarning>
        <body className="sodium">
          <ThemeProvider
            attribute={["class", "data-theme"]}
            defaultTheme="light"
            enableSystem={true}
            storageKey="monotes-theme"
            disableTransitionOnChange
          >
            <SodiumPortalProvider>
              <EditorSettingsProvider>
                <ConvexClientProvider>{children}</ConvexClientProvider>
              </EditorSettingsProvider>
              <Toaster />
            </SodiumPortalProvider>
          </ThemeProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
