import "../impeccable-surfaces.css";

export default function ShareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <div className="aira-impeccable-surface aira-share-surface min-h-dvh">{children}</div>;
}
