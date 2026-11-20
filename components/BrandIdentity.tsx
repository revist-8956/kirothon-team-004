import Image from "next/image";

import styles from "./BrandIdentity.module.css";

/** Screen logo in `public/brand/`; its intrinsic size keeps the layout stable. */
export const BRAND_LOGO_SRC = "/brand/haetnyang-logo-transparent.png";
const BRAND_LOGO_SIZE = 1254;
export const SERVICE_NAME = "했냥?";

interface BrandIdentityProps {
  /** `login` uses the 72px slot of the login screen, `profile` the 60px slot of profile setup. */
  size: "login" | "profile";
  /** Preload the logo; only for above-the-fold entry screens. */
  priority?: boolean;
}

/**
 * Brand block for the entry screens: the transparent team logo on a purple
 * container, followed by the service name. The logo repeats the visible name,
 * so it is decorative (`alt=""`) and the text provides the accessible name.
 */
export function BrandIdentity({ size, priority = false }: BrandIdentityProps) {
  return (
    <div className={`${styles.brand} ${styles[size]}`}>
      <div className={styles.container} data-brand-container="">
        <Image
          className={styles.logo}
          src={BRAND_LOGO_SRC}
          alt=""
          width={BRAND_LOGO_SIZE}
          height={BRAND_LOGO_SIZE}
          // Serve the original file as-is: no re-encoding, so shape and transparency are preserved.
          unoptimized
          preload={priority}
        />
      </div>
      <p className={styles.name}>{SERVICE_NAME}</p>
    </div>
  );
}
