import { z } from "zod";

import { requireUser } from "@/application/authentication";
import { getGroupDetail } from "@/application/group-queries";
import { GroupDetailScreen } from "@/components/groups";
import { GroupDetailHeader } from "@/components/navigation";
import { RouteAccessDeniedState } from "@/components/states";
import { repositories } from "@/infrastructure/prisma-repositories";

const groupIdSchema = z.uuid();

type GroupDetailPageProps = {
  params: Promise<{ groupId: string }>;
};

export default async function GroupDetailPage({ params }: GroupDetailPageProps) {
  const { groupId } = await params;
  const parsedGroupId = groupIdSchema.safeParse(groupId);
  const user = await requireUser(`/groups/${encodeURIComponent(groupId)}`);

  if (!parsedGroupId.success) {
    return <RouteAccessDeniedState />;
  }

  const group = await getGroupDetail(parsedGroupId.data, user.id, repositories);
  if (!group) {
    return <RouteAccessDeniedState />;
  }

  return (
    <>
      <GroupDetailHeader title={group.name} />
      <GroupDetailScreen group={group} viewerId={user.id} />
    </>
  );
}
