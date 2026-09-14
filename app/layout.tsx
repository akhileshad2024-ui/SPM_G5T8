import type { Metadata } from "next";
import { Open_Sans, PT_Sans, Work_Sans } from "next/font/google";
import { AppProvider } from "@/lib/app-context";
import "./globals.css";

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-open-sans",
  display: "swap",
});
const ptSans = PT_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-pt-sans",
  display: "swap",
});
const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-work-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ConnectSphere — Event operations",
  description:
    "One request, one thread, one source of truth: event requests, venue booking, equipment reservation, and registration in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${openSans.variable} ${ptSans.variable} ${workSans.variable}`}>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
