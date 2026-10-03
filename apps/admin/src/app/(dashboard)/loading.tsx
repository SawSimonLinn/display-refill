import { LoaderCircle } from "lucide-react";

/** Shown while a dashboard page loads its data on the server. */
export default function Loading() {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      Loading…
    </p>
  );
}
