import { requireUser } from "@/application/authentication";
import { getComposeOptions } from "@/application/notification-drafts";
import { getGroupDetail } from "@/application/group-queries";
import { ComposeForm, type GroupRecipientPreview } from "@/components/notifications";
import { ComposeHeader } from "@/components/navigation";
import { repositories } from "@/infrastructure/prisma-repositories";

type ComposePageProps = {
  searchParams: Promise<{ mode?: string | string[]; groupId?: string | string[] }>;
};

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Loads only the current user's selectable targets for the first compose step. */
export default async function ComposePage({ searchParams }: ComposePageProps) {
  const query = await searchParams;
  const initialMode = firstQueryValue(query.mode) === "group" ? "GROUP" : "PERSONAL";
  const requestedGroupId = firstQueryValue(query.groupId);
  const user = await requireUser(
    `/notifications/new?mode=${initialMode === "GROUP" ? "group" : "personal"}`,
  );
  const options = await getComposeOptions(repositories, user.id, initialMode);

  if (options.mode === "PERSONAL") {
    return (
      <>
        <ComposeHeader />
        <main className="app-content app-content--with-action">
          <ComposeForm
            friends={options.recipients}
            groups={[]}
            groupRecipientPreviews={[]}
            initialMode="PERSONAL"
          />
        </main>
      </>
    );
  }

  const details = await Promise.all(
    options.groups.map(async (group) => getGroupDetail(group.id, user.id, repositories)),
  );
  const groupRecipientPreviews: GroupRecipientPreview[] = details.flatMap((group) => (
    group
      ? [{
          groupId: group.id,
          recipientNicknames: group.members
            .filter((member) => member.userId !== user.id)
            .map((member) => member.nickname),
        }]
      : []
  ));

  return (
    <>
      <ComposeHeader />
      <main className="app-content app-content--with-action">
        <ComposeForm
          friends={[]}
          groups={options.groups}
          groupRecipientPreviews={groupRecipientPreviews}
          initialMode="GROUP"
          initialGroupId={requestedGroupId}
        />
      </main>
    </>
  );
}
