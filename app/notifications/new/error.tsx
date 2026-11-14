"use client";

import { RouteErrorState } from "@/components/states";

export default function ComposeError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
