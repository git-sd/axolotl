import { Suspense } from "react";
import Scanner from "@/components/scanner";

export default function Home() {
  // Scanner reads ?url= with useSearchParams, which needs a Suspense boundary when prerendered.
  return (
    <Suspense>
      <Scanner />
    </Suspense>
  );
}
