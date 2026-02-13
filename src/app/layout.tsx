import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Westerville Lions Club",
  description: "Creating and fostering a spirit of understanding among all people for humanitarian needs through community service",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        <Header session={session} />
        {children}
        <Footer />
      </body>
    </html>
  );
}
