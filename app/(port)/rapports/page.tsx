import { Suspense } from "react";
import { RapportsPanel } from "@/ui/panels/RapportsPanel";

export default function Page() {
  return (
    <Suspense>
      <RapportsPanel />
    </Suspense>
  );
}
