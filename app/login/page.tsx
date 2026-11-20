import { redirect } from "next/navigation";

import { getOptionalUser } from "@/application/authentication";
import { BrandIdentity } from "@/components/BrandIdentity";
import { sanitizeReturnTo } from "@/domain/return-to";

import { signInWithGoogle } from "./actions";
import styles from "./login.module.css";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    returnTo?: string | string[];
  }>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const returnTo = sanitizeReturnTo(firstValue(parameters.returnTo));
  const signedInUser = await getOptionalUser();

  if (signedInUser) {
    const destination = signedInUser.nicknameRequired
      ? `/profile/setup?returnTo=${encodeURIComponent(returnTo)}`
      : returnTo;
    redirect(destination);
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.introduction} aria-labelledby="login-heading">
        <BrandIdentity size="login" priority />
        <div className={styles.copy}>
          <h1 id="login-heading">알림을 보내고<br />누가 확인했는지<br />한눈에 보세요</h1>
          <p>개인이나 그룹에 보내고, 회차별로 확인 현황을 볼 수 있어요.</p>
        </div>
      </section>

      <section className={styles.signInSection} aria-label="Google 로그인">
        {parameters.error ? (
          <p className={styles.errorMessage} role="alert">
            Google 로그인에 실패했습니다. 다시 시도해 주세요.
          </p>
        ) : null}
        <form action={signInWithGoogle}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className={styles.googleButton} type="submit">
            <span className={styles.googleMark} aria-hidden="true">G</span>
            Google 계정으로 계속하기
          </button>
        </form>
        <p className={styles.signInHint}>처음 로그인하면 계정이 자동으로 만들어져요.</p>
      </section>
    </main>
  );
}
