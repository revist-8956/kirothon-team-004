"use client";

import { RouteErrorState } from "@/components/states";

export default function InboxError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
