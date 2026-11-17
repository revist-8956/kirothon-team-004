import { stopRecurringNotificationAction } from "@/app/actions/sent";
import { requireUser } from "@/application/authentication";
import { getSentNotifications } from "@/application/notification-status";
import { BottomTabBar, appRoutes, notificationStatusRoute } from "@/components/navigation";
import { SentNotificationCard, formatScheduleSummary } from "@/components/sent";
import styles from "@/components/sent/sent.module.css";
import { ButtonLink, PageHeader, StatePanel } from "@/components/ui";
import { repositories } from "@/infrastructure/prisma-repositories";

/** One card per sent notification, linking to its response status (Requirement 17). */
export default async function SentPage() {
  const user = await requireUser(appRoutes.sent);
  const notifications = await getSentNotifications(repositories, user.id);

  return (
    <>
      <main className="app-content app-content--with-tabs">
        <PageHeader
          title="보낸 알림"
          action={
            <ButtonLink size="compact" href={appRoutes.composePersonal}>
              새 알림
            </ButtonLink>
          }
        />
        {notifications.length === 0 ? (
          <StatePanel
            kind="empty"
            title="보낸 알림이 없어요"
            description="알림을 보내면 회차마다 누가 확인했는지 여기서 볼 수 있어요."
            action={<ButtonLink href={appRoutes.composePersonal}>새 알림 작성</ButtonLink>}
          />
        ) : (
          <div className={styles.list}>
            {notifications.map((notification) => (
              <SentNotificationCard
                key={notification.notificationId}
                stopAction={stopRecurringNotificationAction}
                card={{
                  notificationId: notification.notificationId,
                  sentence: notification.sentence,
                  targetLabel: notification.mode === "GROUP" ? (notification.groupName ?? "그룹") : "개인",
                  scheduleSummary: formatScheduleSummary(notification),
                  latestRoundSummary: notification.latestRound
                    ? `${notification.latestRound.sequence}회차 · 확인 ${notification.latestRound.confirmedCount}/${notification.latestRound.recipientCount}`
                    : null,
                  statusHref: notificationStatusRoute(notification.notificationId),
                  canStop: notification.scheduleKind === "RECURRING" && notification.state === "ACTIVE",
                  stopped: notification.state === "STOPPED",
                }}
              />
            ))}
          </div>
        )}
      </main>
      <div className="app-bottom">
        <BottomTabBar current="sent" />
      </div>
    </>
  );
}
