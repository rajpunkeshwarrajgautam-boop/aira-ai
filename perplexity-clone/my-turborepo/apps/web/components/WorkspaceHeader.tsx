import { Suspense } from "react";

import { AiraLogo } from "@/components/AiraLogo";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { cn } from "@/lib/cn";
import styles from "./WorkspaceHeader.module.css";

export function WorkspaceHeader({ className }: { readonly className?: string }) {
  return (
    <header className={cn(styles.header, className)}>
      <div className={styles.inner}>
        <div className={styles.brand}><AiraLogo /></div>
        <div className={styles.nav}><WorkspaceNav /></div>
        <div className={styles.account}>
          <Suspense fallback={<div className={styles.skeleton} aria-hidden />}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
