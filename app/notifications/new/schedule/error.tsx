"use client";

import { RouteErrorState } from "@/components/states";

export default function ScheduleError({ reset }: { reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
