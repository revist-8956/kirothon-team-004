"use client";

import { RouteErrorState } from "@/components/states";

export default function FriendsError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
