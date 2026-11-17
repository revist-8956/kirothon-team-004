"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addFriend, type AddFriendState } from "@/app/actions/friends";
import type { FriendListItem } from "@/application/friends";
import { Avatar, Button, Card, CardHeader, LiveRegion, Notice, StatePanel } from "@/components/ui";

import styles from "./friends-page.module.css";

type AddFriendFormAction = (
  previousState: AddFriendState,
  formData: FormData,
) => Promise<AddFriendState>;

export type FriendsPageProps = {
  readonly friends: readonly FriendListItem[];
  readonly addFriendAction?: AddFriendFormAction;
};

/** Interactive friend list content for the protected friends route. */
export function FriendsPage({ friends, addFriendAction = addFriend }: FriendsPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [state, formAction, isPending] = useActionState(addFriendAction, null);
  const [handledState, setHandledState] = useState(state);
  // Clear the input once per successful submission (adjusted during render, not in an effect).
  if (state !== handledState) {
    setHandledState(state);
    if (state?.ok) {
      setEmail("");
    }
  }
  const emailError = state?.ok === false ? state.fieldErrors?.email?.[0] : undefined;

  useEffect(() => {
    if (state?.ok === false) {
      inputRef.current?.focus();
    }
  }, [state]);


  function focusEmailInput() {
    inputRef.current?.focus();
  }

  return (
    <div className={styles.content}>
      <Card>
        <form action={formAction} className={styles.addFriendForm} noValidate>
          {state?.ok === false ? (
            <p className={styles.errorSummary} role="alert">
              {state.message}
            </p>
          ) : null}
          <label className={styles.label} htmlFor="friend-email">
            이메일로 친구 추가
          </label>
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              id="friend-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="friend@example.com"
              autoComplete="email"
              aria-describedby={emailError ? "friend-email-error" : undefined}
              aria-invalid={emailError ? true : undefined}
              className={styles.input}
            />
            <Button type="submit" size="compact" disabled={isPending}>
              {isPending ? "추가하는 중..." : "추가"}
            </Button>
          </div>
          <p className={styles.description}>가입된 사용자의 이메일 주소를 입력하세요.</p>
          {emailError ? (
            <p id="friend-email-error" className={styles.fieldError}>
              {emailError}
            </p>
          ) : null}
          {state?.ok === false && !emailError ? (
            <p className={styles.fieldError}>{state.message}</p>
          ) : null}
          {state?.ok ? <LiveRegion>{state.message ?? "친구를 추가했어요."}</LiveRegion> : null}
        </form>
      </Card>

      <Card className={styles.friendCard}>
        <CardHeader
          title={
            <>
              내 친구 <span className={styles.count}>{friends.length}</span>
            </>
          }
        />
        {friends.length > 0 ? (
          <ul className={styles.friendList} aria-label="내 친구 목록">
            {friends.map((friend) => (
              <li className={styles.friendItem} key={friend.email}>
                <Avatar initial={friend.nickname} name={friend.nickname} />
                <div className={styles.friendDetails}>
                  <span className={styles.friendName}>{friend.nickname}</span>
                  <span className={styles.friendEmail}>{friend.email}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <StatePanel
            kind="empty"
            title="아직 친구가 없어요"
            description="이메일 주소를 입력해 친구를 추가해 보세요."
            action={
              <Button type="button" variant="secondary" onClick={focusEmailInput}>
                이메일로 친구 추가
              </Button>
            }
          />
        )}
      </Card>

      <Notice>개인 발송은 친구 목록에 있는 사용자에게만 보낼 수 있어요.</Notice>
    </div>
  );
}
