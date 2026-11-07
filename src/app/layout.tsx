import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import SmoothScroll from "@/components/SmoothScroll";
import { SimonProvider } from "@/context/SimonContext";
import { SimonLayoutWrapper } from "@/components/simon/SimonLayoutWrapper";
import { SimonDockedSidebar } from "@/components/simon/SimonDockedSidebar";
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
      /* The script below writes `data-theme` before React hydrates, so the
         browser's attribute legitimately differs from the server's. This
         suppresses that one warning instead of declaring the whole subtree
         uncheckable. */
      suppressHydrationWarning
      className={`${bebas.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        {/* Reconcile the stored theme before first paint. Dark is the default
            the server renders; this runs before the CSS is painted so a
            light-preference visitor never sees a dark flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("luxonn:theme");if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <SmoothScroll>
          <SimonProvider>
            <SimonLayoutWrapper>{children}</SimonLayoutWrapper>
            <SimonDockedSidebar />
          </SimonProvider>
        </SmoothScroll>
      </body>
    </html>
  );
}
