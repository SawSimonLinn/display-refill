import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "POGs" };

export default function Page() {
  return <PlaceholderPage title="POGs" feature="Feature 05" description="Admins will draw slot rectangles over a reference photo and publish immutable versions." />;
}
