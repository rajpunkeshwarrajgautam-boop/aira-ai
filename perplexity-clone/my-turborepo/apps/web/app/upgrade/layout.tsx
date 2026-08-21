import "../impeccable-surfaces.css";

export default function UpgradeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <div className="aira-impeccable-surface aira-upgrade-surface min-h-dvh">{children}</div>;
}
