import { ComposeHeader } from "@/components/navigation";

import { ScheduleForm } from "./schedule-form";

type ScheduleRouteProps = {
  searchParams: Promise<{ draft?: string | string[] }>;
};

/**
 * Second notification-compose step. The draft ID is retained in the client
 * form and handed to the reservation command when Task 7.7 wires it in.
 */
export default async function ScheduleRoute({ searchParams }: ScheduleRouteProps) {
  const { draft } = await searchParams;
  const draftId = typeof draft === "string" ? draft : undefined;

  return (
    <>
      <ComposeHeader step="2 / 2" />
      <main className="app-content">
        <ScheduleForm draftId={draftId} />
      </main>
    </>
  );
}
