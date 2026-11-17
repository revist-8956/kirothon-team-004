"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createNotificationDraftAction,
  type CreateNotificationDraftState,
} from "@/app/actions/notifications";
import type { ComposeFriendOptionRecord, GroupListItem } from "@/application/repositories";
import { appRoutes } from "@/components/navigation";
import {
  Button,
  ButtonLink,
  Card,
  CheckboxField,
  LiveRegion,
  RadioField,
  SegmentedControl,
  StatePanel,
  TextAreaField,
} from "@/components/ui";

import styles from "./compose-form.module.css";

type ComposeMode = "PERSONAL" | "GROUP";

type CreateDraftFormAction = (
  previousState: CreateNotificationDraftState,
  formData: FormData,
) => Promise<CreateNotificationDraftState>;

export type GroupRecipientPreview = {
  readonly groupId: string;
  readonly recipientNicknames: readonly string[];
};

export type ComposeFormProps = {
  readonly friends: readonly ComposeFriendOptionRecord[];
  readonly groups: readonly GroupListItem[];
  readonly groupRecipientPreviews: readonly GroupRecipientPreview[];
  readonly initialMode: ComposeMode;
  readonly initialGroupId?: string;
  readonly createDraftAction?: CreateDraftFormAction;
};

function fieldError(state: CreateNotificationDraftState, field: string): string | undefined {
  return state?.ok === false ? state.fieldErrors?.[field]?.[0] : undefined;
}

function recipientPreviewText(nicknames: readonly string[]): string {
  if (nicknames.length <= 3) return nicknames.join(", ");
  return `${nicknames.slice(0, 3).join(", ")} 외 ${nicknames.length - 3}명`;
}

/** First notification step for either personal or single-group delivery. */
export function ComposeForm({
  friends,
  groups,
  groupRecipientPreviews,
  initialMode,
  initialGroupId,
  createDraftAction = createNotificationDraftAction,
}: ComposeFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ComposeMode>(initialMode);
  const [sentence, setSentence] = useState("");
  const [recipientIds, setRecipientIds] = useState<readonly string[]>([]);
  const [formVersion, setFormVersion] = useState(0);
  const [groupId, setGroupId] = useState<string | undefined>(() => (
    initialMode === "GROUP" && initialGroupId && groups.some((group) => group.id === initialGroupId)
      ? initialGroupId
      : undefined
  ));
  const [state, formAction, pending] = useActionState(createDraftAction, null);
  const [handledState, setHandledState] = useState(state);
  // Remount the form once per failed submission (adjusted during render, not in an effect).
  if (state !== handledState) {
    setHandledState(state);
    if (state?.ok === false) {
      setFormVersion((current) => current + 1);
    }
  }
  const sentenceError = fieldError(state, "sentence");
  const recipientError = fieldError(state, "recipientIds");
  const groupError = fieldError(state, "groupId");

  const selectedPreview = useMemo(
    () => groupRecipientPreviews.find((preview) => preview.groupId === groupId),
    [groupId, groupRecipientPreviews],
  );

  useEffect(() => {
    if (state?.ok) {
      router.push(`${appRoutes.schedule}?draftId=${encodeURIComponent(state.data.draftId)}`);
    }
  }, [router, state]);


  useEffect(() => {
    if (state?.ok === false) {
      document.getElementById("notification-sentence")?.focus();
    }
  }, [formVersion, state]);

  function changeMode(nextMode: string) {
    if (nextMode === "PERSONAL" || nextMode === "GROUP") {
      setMode(nextMode);
    }
  }

  function toggleRecipient(recipientId: string, checked: boolean) {
    setRecipientIds((current) => (
      checked
        ? [...current, recipientId]
        : current.filter((id) => id !== recipientId)
    ));
  }

  return (
    <form key={formVersion} action={formAction} className={styles.composeForm} noValidate>
      <input type="hidden" name="mode" value={mode} />
      {state?.ok === false ? <p className={styles.errorSummary} role="alert">{state.message}</p> : null}

      <Card>
        <TextAreaField
          id="notification-sentence"
          name="sentence"
          label="어떤 알림을 보낼까요?"
          description="제목 없이 한 문장으로 보내요."
          error={sentenceError}
          value={sentence}
          onChange={(event) => setSentence(event.target.value)}
          placeholder="예: 주간 회의 자료 제출"
          rows={3}
          autoFocus={state?.ok === false}
          disabled={pending}
        />
      </Card>

      <Card>
        <div className={styles.recipientIntro}>
          <h2>누구에게 보낼까요?</h2>
          <SegmentedControl
            legend="발송 방식"
            name="delivery-mode"
            value={mode}
            onChange={changeMode}
            options={[
              { value: "PERSONAL", label: "개인" },
              { value: "GROUP", label: "그룹" },
            ]}
          />
          <p>개인과 그룹은 함께 지정할 수 없어요.</p>
        </div>
      </Card>

      {mode === "PERSONAL" ? (
        <fieldset className={styles.choiceCard} aria-describedby={recipientError ? "recipient-error" : "recipient-description"}>
          <legend>받는 친구 <span className={styles.accentCount}>{friends.length}</span></legend>
          {friends.length === 0 ? (
            <StatePanel
              kind="empty"
              title="아직 친구가 없어요"
              description="친구를 추가한 뒤 개인 알림을 보낼 수 있어요."
              action={<ButtonLink variant="secondary" href={appRoutes.friends}>친구 추가하기</ButtonLink>}
            />
          ) : (
            <div className={styles.choiceList}>
              {friends.map((friend) => (
                <CheckboxField
                  key={friend.id}
                  id={`recipient-${friend.id}`}
                  name="recipientIds"
                  value={friend.id}
                  label={friend.nickname}
                  description={friend.email}
                  checked={recipientIds.includes(friend.id)}
                  onChange={(event) => toggleRecipient(friend.id, event.target.checked)}
                  disabled={pending}
                />
              ))}
            </div>
          )}
          <p id="recipient-description" className={styles.supportText}>
            친구 목록에 있는 사용자만 선택할 수 있어요. 한 명 이상 골라 주세요.
          </p>
          {recipientError ? <p id="recipient-error" className={styles.fieldError} role="alert">{recipientError}</p> : null}
        </fieldset>
      ) : (
        <fieldset className={styles.choiceCard} aria-describedby={groupError ? "group-error" : "group-description"}>
          <legend>받는 그룹 (한 그룹만)</legend>
          {groups.length === 0 ? (
            <StatePanel
              kind="empty"
              title="아직 속한 그룹이 없어요"
              description="그룹을 만들거나 초대를 수락한 뒤 그룹 알림을 보낼 수 있어요."
              action={<ButtonLink variant="secondary" href={appRoutes.groups}>그룹으로 이동</ButtonLink>}
            />
          ) : (
            <div className={styles.choiceList}>
              {groups.map((group) => (
                <RadioField
                  key={group.id}
                  id={`group-${group.id}`}
                  name="groupId"
                  value={group.id}
                  label={group.name}
                  description={`구성원 ${group.memberCount}명`}
                  checked={groupId === group.id}
                  onChange={() => setGroupId(group.id)}
                  disabled={pending}
                />
              ))}
            </div>
          )}
          <p id="group-description" className={styles.supportText}>
            내가 현재 속한 그룹 하나만 선택할 수 있어요.
          </p>
          {groupError ? <p id="group-error" className={styles.fieldError} role="alert">{groupError}</p> : null}
          {selectedPreview ? (
            <div className={styles.recipientPreview} aria-live="polite">
              <strong>수신 예정 {selectedPreview.recipientNicknames.length}명{selectedPreview.recipientNicknames.length > 0 ? ` · ${recipientPreviewText(selectedPreview.recipientNicknames)}` : ""}</strong>
              <span>발송 시점의 구성원 중 나를 제외한 전원이 받아요. 반복 알림은 회차마다 다시 정해져요.</span>
            </div>
          ) : null}
        </fieldset>
      )}

      <div className="app-bottom">
        <div className="app-bottom__actions">
          <Button type="submit" disabled={pending}>
            {pending ? "저장하는 중" : "다음"}
          </Button>
        </div>
      </div>
      <LiveRegion>{state?.ok ? "일정 설정 화면으로 이동합니다." : ""}</LiveRegion>
    </form>
  );
}
