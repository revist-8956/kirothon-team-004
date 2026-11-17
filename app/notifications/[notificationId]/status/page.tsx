import { requireUser } from "@/application/authentication";
import { getNotificationStatus } from "@/application/notification-status";
import { BottomTabBar, notificationStatusRoute } from "@/components/navigation";
import { NotificationStatusContent, StatusAccessDenied } from "@/components/status";
import { repositories } from "@/infrastructure/prisma-repositories";

type StatusPageProps = {
  params: Promise<{ notificationId: string }>;
  searchParams: Promise<{ dispatchId?: string | string[] }>;
};

/** Response status of one notification; what is shown depends on the viewer's role (Req. 14–16). */
export default async function NotificationStatusPage({ params, searchParams }: StatusPageProps) {
  const { notificationId } = await params;
  const { dispatchId } = await searchParams;
  const user = await requireUser(notificationStatusRoute(notificationId));
  const status = await getNotificationStatus(
    repositories,
    user.id,
    notificationId,
    typeof dispatchId === "string" ? dispatchId : undefined,
  );

  return (
    <>
      <main className="app-content app-content--with-tabs">
        {status.kind === "FORBIDDEN" ? <StatusAccessDenied /> : <NotificationStatusContent status={status} />}
      </main>
      <div className="app-bottom">
        <BottomTabBar current="sent" />
      </div>
    </>
  );
}
