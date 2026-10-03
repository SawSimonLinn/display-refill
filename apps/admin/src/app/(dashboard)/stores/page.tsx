import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Stores" };

export default function Page() {
  return <PlaceholderPage title="Stores" feature="Feature 04" description="Admins will create and archive stores here." />;
}
