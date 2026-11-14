import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "알림 서비스",
  description: "개인·그룹 알림 서비스",
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
