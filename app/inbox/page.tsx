import { confirmDispatchAction } from "@/app/actions/inbox";
import { requireUser } from "@/application/authentication";
import { getInbox } from "@/application/inbox";
import { ReceivedDispatchCard, formatCardMeta } from "@/components/inbox";
import styles from "@/components/inbox/inbox.module.css";
import { BottomTabBar, appRoutes, notificationStatusRoute } from "@/components/navigation";
import { ButtonLink, Notice, PageHeader, StatePanel } from "@/components/ui";
import { repositories } from "@/infrastructure/prisma-repositories";

/** Received dispatch cards; each round is read and confirmed on its card (no detail route). */
export default async function InboxPage() {
  const user = await requireUser(appRoutes.inbox);
  const inbox = await getInbox(repositories, user.id);

  return (
    <>
      <main className="app-content app-content--with-tabs">
        <PageHeader
          title="받은 알림"
          eyebrow={
            inbox.cards.length > 0 ? (
              <>
                아직 확인하지 않은 알림{" "}
                <span className={styles.headerCount}>{inbox.unconfirmedCount}건</span>
              </>
            ) : undefined
          }
          action={
            <ButtonLink size="compact" href={appRoutes.composePersonal}>
              새 알림
            </ButtonLink>
          }
        />
        {inbox.cards.length === 0 ? (
          <StatePanel
            kind="empty"
            title="받은 알림이 없어요"
            description="친구나 그룹이 보낸 알림이 여기에 회차별로 보여요."
            action={<ButtonLink href={appRoutes.composePersonal}>새 알림 작성</ButtonLink>}
          />
        ) : (
          <div className={styles.list}>
            {inbox.cards.map((card) => (
              <ReceivedDispatchCard
                key={card.dispatchId}
                confirmAction={confirmDispatchAction}
                card={{
                  dispatchId: card.dispatchId,
                  sentence: card.sentence,
                  mode: card.mode,
                  meta: formatCardMeta(card),
                  confirmedAt: card.confirmedAt?.toISOString() ?? null,
                  ...(card.mode === "GROUP"
                    ? {
                        statusHref: `${notificationStatusRoute(card.notificationId)}?dispatchId=${encodeURIComponent(card.dispatchId)}`,
                      }
                    : {}),
                }}
              />
            ))}
            <Notice>‘확인’ 버튼을 눌러야 확인으로 바뀌어요. 반복 알림은 회차마다 따로 보여요.</Notice>
          </div>
        )}
      </main>
      <div className="app-bottom">
        <BottomTabBar current="inbox" />
      </div>
    </>
  );
}
