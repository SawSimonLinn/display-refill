import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Scans" };

export default function Page() {
  return <PlaceholderPage title="Scans" feature="Feature 11" description="Scan history and review will appear here." />;
}
