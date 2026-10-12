import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import SmoothScroll from "@/components/SmoothScroll";
import "./globals.css";

const bebas = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LUXONN — Luxury Real Estate, Kenya",
  description:
    "LUXONN curates Kenya's most exceptional residences. Discover verified architectural masterpieces across Nairobi and beyond.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bebas.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
