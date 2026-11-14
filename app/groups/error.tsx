"use client";

import { RouteErrorState } from "@/components/states";

export default function GroupsError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
