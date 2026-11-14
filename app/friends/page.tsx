import { requireUser } from "@/application/authentication";
import { getFriends } from "@/application/friends";
import { BottomTabBar, appRoutes } from "@/components/navigation";
import { ButtonLink, PageHeader } from "@/components/ui";
import { repositories } from "@/infrastructure/prisma-repositories";

import { FriendsPage } from "./friends-page";

/** Shows the current user's directional friend list and add-friend form. */
export default async function FriendsRoute() {
  const user = await requireUser(appRoutes.friends);
  const friends = await getFriends(repositories, user.id);

  return (
    <>
      <main className="app-content app-content--with-action-and-tabs">
        <PageHeader title="친구" />
        <FriendsPage friends={friends} />
      </main>
      <div className="app-bottom">
        <div className="app-bottom__actions">
          <ButtonLink className="app-bottom__action" href={appRoutes.composePersonal}>
            새 알림 작성
          </ButtonLink>
        </div>
        <BottomTabBar current="friends" />
      </div>
    </>
  );
}
