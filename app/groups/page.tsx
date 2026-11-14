import { requireUser } from "@/application/authentication";
import { getGroups } from "@/application/group-queries";
import { GroupsScreen } from "@/components/groups";
import { BottomTabBar, appRoutes } from "@/components/navigation";
import { repositories } from "@/infrastructure/prisma-repositories";

export default async function GroupsPage() {
  const user = await requireUser("/groups");
  const groups = await getGroups(user.id, repositories);

  return (
    <>
      <main className="app-content app-content--with-action-and-tabs">
        <GroupsScreen groups={groups} />
      </main>
      <div className="app-bottom">
        <div className="app-bottom__actions">
          <a className="app-bottom__action" href={appRoutes.composeGroup}>새 알림 작성</a>
        </div>
        <BottomTabBar current="groups" />
      </div>
    </>
  );
}
