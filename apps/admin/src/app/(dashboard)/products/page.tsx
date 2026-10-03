import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Products" };

export default function Page() {
  return <PlaceholderPage title="Products" feature="Feature 04" description="Admins will maintain the shared product catalog here." />;
}
