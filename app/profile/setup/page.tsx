import { redirect } from "next/navigation";

import { requireUser } from "@/application/authentication";
import { BrandIdentity } from "@/components/BrandIdentity";
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
        <BrandIdentity size="profile" priority />
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
