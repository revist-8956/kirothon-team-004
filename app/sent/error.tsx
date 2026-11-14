"use client";

import { RouteErrorState } from "@/components/states";

export default function SentError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
