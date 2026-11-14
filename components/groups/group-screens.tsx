"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  acceptInviteAction,
  createGroupAction,
  issueInviteLinkAction,
  leaveGroupAction,
  setGroupEmailVisibilityAction,
  type GroupActionState,
} from "@/app/actions/groups";
import { appRoutes, groupDetailRoute } from "@/components/navigation";
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Dialog,
  LiveRegion,
  Notice,
  StatePanel,
  Switch,
} from "@/components/ui";

import type { GroupDetailRecord, GroupListItem } from "@/application/repositories";

import styles from "./groups.module.css";

function errorMessage(state: GroupActionState, field?: string): string | undefined {
  if (!state || state.ok) return undefined;
  return field ? state.fieldErrors?.[field]?.[0] ?? state.message : state.message;
}

function groupInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "그";
}

function formatLatestDispatch(value: Date | null): string {
  if (!value) return "최근 발송 없음";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(value);
}

export function GroupsScreen({ groups }: { groups: readonly GroupListItem[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createGroupAction, null);
  const nameError = errorMessage(state, "name");

  useEffect(() => {
    if (state?.ok && state.data.groupId) {
      router.push(groupDetailRoute(state.data.groupId));
    }
  }, [router, state]);

  return (
    <div className={styles.listPage}>
      <Card>
        <form action={formAction} className={styles.createForm}>
          <label className={styles.cardLabel} htmlFor="group-name">새 그룹 만들기</label>
          <div className={styles.inlineControl}>
            <input
              id="group-name"
              name="name"
              className={styles.input}
              placeholder="그룹 이름"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "group-name-error" : "group-name-description"}
              disabled={pending}
            />
            <Button type="submit" size="compact" disabled={pending}>
              {pending ? "만드는 중" : "만들기"}
            </Button>
          </div>
          <p id="group-name-description" className={styles.supportText}>
            만든 뒤 초대 링크로 구성원을 초대해요.
          </p>
          {nameError ? <p id="group-name-error" className={styles.fieldError} role="alert">{nameError}</p> : null}
          {!state?.ok && errorMessage(state) && !nameError ? <Notice tone="error">{errorMessage(state)}</Notice> : null}
        </form>
      </Card>

      {groups.length === 0 ? (
        <StatePanel
          kind="empty"
          title="아직 속한 그룹이 없어요"
          description="위에서 새 그룹을 만들거나 초대 링크로 그룹에 가입해 보세요."
        />
      ) : (
        <Card className={styles.groupListCard}>
          <CardHeader title={<>내가 속한 그룹 <span className={styles.accentCount}>{groups.length}</span></>} />
          <ul className={styles.groupList} aria-label="내가 속한 그룹 목록">
            {groups.map((group) => (
              <li key={group.id}>
                <a className={styles.groupRow} href={groupDetailRoute(group.id)}>
                  <Avatar initial={groupInitial(group.name)} name={group.name} shape="group" size="large" />
                  <span className={styles.rowContent}>
                    <strong>{group.name}</strong>
                    <span>구성원 {group.memberCount}명 · {formatLatestDispatch(group.latestDispatchSentAt)}</span>
                  </span>
                  <span className={styles.chevron} aria-hidden="true">›</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Notice>내가 속한 그룹만 보여요. 속하지 않은 그룹에는 발송하거나 기록을 볼 수 없어요.</Notice>
      <LiveRegion>{state?.ok ? state.message : ""}</LiveRegion>
    </div>
  );
}

export function GroupDetailScreen({ group, viewerId }: { group: GroupDetailRecord; viewerId: string }) {
  const router = useRouter();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [isCopying, startCopying] = useTransition();
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">(group.emailVisibility);
  const [isSavingVisibility, startSavingVisibility] = useTransition();
  const [isLeaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [isLeaving, startLeaving] = useTransition();

  function handleCopy() {
    setFeedback("");
    startCopying(async () => {
      const result = await issueInviteLinkAction(group.id);
      if (!result.ok || !result.data.inviteUrl) {
        setFeedback(result.ok ? "초대 링크를 만들지 못했어요. 다시 복사해 주세요." : result.message);
        return;
      }

      const absoluteUrl = new URL(result.data.inviteUrl, window.location.origin).toString();
      setInviteUrl(absoluteUrl);
      try {
        await navigator.clipboard.writeText(absoluteUrl);
        setFeedback("초대 링크를 복사했어요.");
      } catch {
        setFeedback("초대 링크를 복사하지 못했어요. 링크를 선택해 다시 복사해 주세요.");
      }
    });
  }

  function handleVisibilityChange(nextVisibility: boolean) {
    const target = nextVisibility ? "PUBLIC" : "PRIVATE";
    setFeedback("");
    startSavingVisibility(async () => {
      const result = await setGroupEmailVisibilityAction(group.id, target);
      if (result.ok && result.data.emailVisibility) {
        setVisibility(result.data.emailVisibility);
        setFeedback(result.message ?? "이메일 공개 설정을 저장했어요.");
        router.refresh();
        return;
      }
      setFeedback(result.ok ? "이메일 공개 설정을 저장하지 못했어요." : result.message);
    });
  }

  function handleLeave() {
    startLeaving(async () => {
      const result = await leaveGroupAction(group.id);
      if (result.ok) {
        router.replace(appRoutes.groups);
        router.refresh();
        return;
      }
      setLeaveDialogOpen(false);
      setFeedback(result.message);
    });
  }

  return (
    <>
      <main className={`app-content app-content--with-action ${styles.detailPage}`}>
        <Card>
          <CardHeader title="초대 링크" />
          <div className={styles.inlineControl}>
            <output className={styles.inviteUrl} aria-label="초대 링크">
              {inviteUrl ?? "초대 링크를 복사해 공유할 수 있어요."}
            </output>
            <Button variant="secondary" size="compact" onClick={handleCopy} disabled={isCopying}>
              {isCopying ? "준비 중" : feedback.includes("복사하지 못했") ? "다시 복사" : "복사"}
            </Button>
          </div>
          <p className={styles.supportText}>친구가 아니어도 링크로 가입할 수 있어요. 초대를 수락한 시점부터 구성원이 돼요.</p>
        </Card>

        <Card className={styles.visibilityCard}>
          <Switch
            id="group-email-visibility"
            checked={visibility === "PUBLIC"}
            label="내 이메일 공개"
            description="끄면 구성원 목록에 닉네임만 보여요."
            onCheckedChange={handleVisibilityChange}
            disabled={isSavingVisibility}
          />
        </Card>

        <Card className={styles.memberCard}>
          <CardHeader title={<>구성원 <span className={styles.accentCount}>{group.members.length}</span></>} />
          {group.members.length === 0 ? (
            <p className={styles.supportText}>표시할 구성원이 없어요.</p>
          ) : (
            <ul className={styles.memberList} aria-label={`${group.name} 구성원 목록`}>
              {group.members.map((member) => (
                <li className={styles.memberRow} key={member.userId}>
                  <Avatar initial={member.nickname} name={member.nickname} />
                  <span className={styles.rowContent}>
                    <span>{member.nickname}{member.userId === viewerId ? " (나)" : ""}</span>
                    {member.email ? <span>{member.email}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <LiveRegion>{feedback}</LiveRegion>
      </main>

      <div className="app-bottom">
        <div className={styles.detailActions}>
          <Button variant="neutral" onClick={() => setLeaveDialogOpen(true)}>그룹 탈퇴</Button>
          <ButtonLink href={`${appRoutes.composeGroup}&groupId=${encodeURIComponent(group.id)}`}>이 그룹에 알림 보내기</ButtonLink>
        </div>
      </div>

      <Dialog
        open={isLeaveDialogOpen}
        title={`${group.name}에서 탈퇴할까요?`}
        description="탈퇴하면 이 그룹의 알림과 응답 현황을 더 이상 볼 수 없어요."
        cancelLabel="계속 참여"
        confirmLabel={isLeaving ? "탈퇴하는 중" : "탈퇴"}
        destructive
        onClose={() => !isLeaving && setLeaveDialogOpen(false)}
        onConfirm={handleLeave}
      />
    </>
  );
}

export type InviteScreenData = {
  readonly token: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly inviterNickname: string;
  readonly currentMemberCount: number;
  readonly alreadyMember: boolean;
};

export function InviteScreen({ invite }: { invite: InviteScreenData }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [isAccepting, startAccepting] = useTransition();

  function accept() {
    setFeedback("");
    startAccepting(async () => {
      const result = await acceptInviteAction(invite.token);
      if (result.ok && result.data.groupId) {
        router.push(groupDetailRoute(result.data.groupId));
        return;
      }
      setFeedback(result.ok ? "초대를 수락하지 못했어요. 다시 시도해 주세요." : result.message);
    });
  }

  if (invite.alreadyMember) {
    return (
      <main className={styles.invitePage}>
        <Avatar initial={groupInitial(invite.groupName)} shape="group" size="large" />
        <div className={styles.inviteIntro}>
          <h1>{invite.groupName}에<br />이미 참여 중이에요</h1>
          <p>구성원 {invite.currentMemberCount}명</p>
        </div>
        <Notice>기존 가입 시점과 이메일 공개 설정은 그대로 유지돼요.</Notice>
        <ButtonLink href={groupDetailRoute(invite.groupId)}>그룹으로 이동</ButtonLink>
      </main>
    );
  }

  return (
    <main className={styles.invitePage}>
      <Avatar initial={groupInitial(invite.groupName)} shape="group" size="large" />
      <div className={styles.inviteIntro}>
        <h1>{invite.groupName}에<br />초대받았어요</h1>
        <p>{invite.inviterNickname} 님이 초대했어요 · 구성원 {invite.currentMemberCount}명</p>
      </div>
      <section className={styles.inviteBenefits} aria-labelledby="invite-benefits-title">
        <h2 id="invite-benefits-title">수락하면</h2>
        <ul>
          <li>지금부터 그룹 구성원이 돼요.</li>
          <li>이 그룹에 알림을 보내고 받을 수 있어요.</li>
          <li>가입 이후 발송된 회차의 알림과 응답 현황만 볼 수 있어요.</li>
          <li>구성원 목록에는 닉네임만 보여요. 이메일 공개는 직접 선택해요.</li>
        </ul>
      </section>
      <p className={styles.inviteWarning}>수락 전에는 그룹에 포함되지 않으며, 발송하거나 응답 현황을 볼 수 없어요.</p>
      <LiveRegion>{feedback}</LiveRegion>
      <div className={styles.inviteActions}>
        <ButtonLink href={appRoutes.inbox} variant="neutral">나중에</ButtonLink>
        <Button onClick={accept} disabled={isAccepting}>{isAccepting ? "수락하는 중" : "초대 수락"}</Button>
      </div>
    </main>
  );
}
