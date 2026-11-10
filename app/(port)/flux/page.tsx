import { Suspense } from "react";
import { FluxPanel } from "@/ui/panels/FluxPanel";

export default function Page() {
  return (
    <Suspense>
      <FluxPanel />
    </Suspense>
  );
}
