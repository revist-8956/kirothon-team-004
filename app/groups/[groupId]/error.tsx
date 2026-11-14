"use client";

import { RouteErrorState } from "@/components/states";

export default function GroupDetailError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
