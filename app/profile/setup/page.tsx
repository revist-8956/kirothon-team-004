import { redirect } from "next/navigation";

import { requireUser } from "@/application/authentication";
import { sanitizeReturnTo } from "@/domain/return-to";

import { ProfileSetupForm } from "./profile-setup-form";
import styles from "./profile-setup.module.css";

type ProfileSetupPageProps = {
  searchParams: Promise<{
    returnTo?: string | string[];
  }>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProfileSetupPage({ searchParams }: ProfileSetupPageProps) {
  const parameters = await searchParams;
  const returnTo = sanitizeReturnTo(firstValue(parameters.returnTo));
  const user = await requireUser(returnTo, { allowNicknameRequired: true });

  if (!user.nicknameRequired) {
    redirect(returnTo);
  }

  return (
    <main className={styles.profileSetupPage}>
      <section className={styles.content} aria-labelledby="profile-setup-heading">
        <div className={styles.appIcon} aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M6 16h12l-1.5-2v-4a4.5 4.5 0 0 0-9 0v4L6 16z" />
            <path d="M10 19.5h4" />
          </svg>
        </div>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>프로필 설정</p>
          <h1 id="profile-setup-heading">사용할 닉네임을 정해 주세요</h1>
          <p>Google 프로필 이름은 표시 이름으로 사용할 수 없어요.</p>
        </div>
        <ProfileSetupForm initialNickname={user.nickname} returnTo={returnTo} />
      </section>
    </main>
  );
}
