"use client";

import { useActionState } from "react";

import { updateNickname, type UpdateNicknameState } from "@/app/actions/profile";
import { Button, TextField } from "@/components/ui";

import styles from "./profile-setup-form.module.css";

type ProfileSetupFormProps = {
  readonly initialNickname: string;
  readonly returnTo: string;
};

const initialState: UpdateNicknameState = null;

export function ProfileSetupForm({
  initialNickname,
  returnTo,
}: ProfileSetupFormProps) {
  const [state, formAction, isPending] = useActionState(updateNickname, initialState);
  const nicknameError = state?.ok === false ? state.fieldErrors?.nickname?.[0] : undefined;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <TextField
        id="nickname"
        name="nickname"
        type="text"
        label="닉네임"
        defaultValue={initialNickname}
        autoComplete="nickname"
        maxLength={40}
        required
        error={nicknameError}
        description="다른 사용자에게 표시될 이름이에요. 1자 이상 20자 이하로 입력해 주세요."
      />
      {state?.ok === false && !nicknameError ? (
        <p role="alert">{state.message}</p>
      ) : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "저장하는 중..." : "시작하기"}
      </Button>
    </form>
  );
}
