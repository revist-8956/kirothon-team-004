"use client";

import { RouteErrorState } from "@/components/states";

export default function NotificationStatusError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
