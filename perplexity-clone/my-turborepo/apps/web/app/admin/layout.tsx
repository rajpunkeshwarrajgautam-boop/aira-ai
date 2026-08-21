import "../impeccable-surfaces.css";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <div className="aira-impeccable-surface aira-admin-surface min-h-dvh">{children}</div>;
}
