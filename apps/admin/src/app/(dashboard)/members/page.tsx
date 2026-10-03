import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Members" };

export default function Page() {
  return <PlaceholderPage title="Members" feature="Feature 03" description="Admins will invite users and assign store roles." />;
}
