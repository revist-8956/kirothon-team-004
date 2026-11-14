import { redirect } from "next/navigation";

import { getOptionalUser } from "@/application/authentication";
import { getInvite } from "@/application/invites";
import { InviteScreen } from "@/components/groups";
import { appRoutes } from "@/components/navigation";
import { ButtonLink, StatePanel } from "@/components/ui";
import { repositories } from "@/infrastructure/prisma-repositories";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const viewer = await getOptionalUser();
  const invite = await getInvite(repositories, token, viewer?.id);

  if (!invite) {
    return (
      <main className="app-content">
        <StatePanel
          kind="unavailable"
          title="유효하지 않은 초대예요"
          description="초대 링크를 다시 확인해 주세요. 그룹 정보는 표시하지 않아요."
          action={<ButtonLink href={appRoutes.inbox}>받은 알림으로 이동</ButtonLink>}
        />
      </main>
    );
  }

  if (!viewer) {
    redirect(`/login?returnTo=${encodeURIComponent(invite.returnTo)}`);
  }

  return (
    <InviteScreen
      invite={{
        token,
        groupId: invite.groupId,
        groupName: invite.groupName,
        inviterNickname: invite.inviterNickname,
        currentMemberCount: invite.currentMemberCount,
        alreadyMember: invite.alreadyMember,
      }}
    />
  );
}
