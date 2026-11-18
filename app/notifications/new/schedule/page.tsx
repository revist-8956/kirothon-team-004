import { scheduleNotificationAction } from "@/app/actions/notifications";
import { requireUser } from "@/application/authentication";
import { ComposeHeader, appRoutes } from "@/components/navigation";
import { ButtonLink, StatePanel } from "@/components/ui";
import { ScheduleForm } from "./schedule-form";

type ScheduleRouteProps = {
  searchParams: Promise<{ draftId?: string | string[] }>;
};

/**
 * Second notification-compose step. The compose step sends `?draftId=`; the
 * reservation action re-checks the draft owner, expiry and permissions.
 */
export default async function ScheduleRoute({ searchParams }: ScheduleRouteProps) {
  const { draftId: draftIdValue } = await searchParams;
  const draftId = typeof draftIdValue === "string" && draftIdValue ? draftIdValue : undefined;
  await requireUser(
    draftId ? `${appRoutes.schedule}?draftId=${encodeURIComponent(draftId)}` : appRoutes.schedule,
  );

  return (
    <>
      <ComposeHeader step="2 / 2" />
      <main className="app-content">
        {draftId ? (
          <ScheduleForm draftId={draftId} onSchedule={scheduleNotificationAction} />
        ) : (
          <StatePanel
            kind="unavailable"
            title="알림 작성 정보가 없어요"
            description="알림 문장과 받는 사람을 먼저 정해 주세요."
            action={<ButtonLink href={appRoutes.composePersonal}>알림 작성하기</ButtonLink>}
          />
        )}
      </main>
    </>
  );
}
