import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Displays" };

export default function Page() {
  return <PlaceholderPage title="Displays" feature="Feature 04" description="Managers will create displays and assign published POG versions for their stores." />;
}
