import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "했냥?",
  description: "했냥?에서 친구나 그룹에 알림을 보내고 회차별 확인 현황을 확인하세요.",
  icons: {
    icon: "/brand/haetnyang-logo-purple-background.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">
          <div className="app-shell__viewport">{children}</div>
        </div>
      </body>
    </html>
  );
}
