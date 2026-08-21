import "../impeccable-surfaces.css";

export default function SignInLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <div className="aira-impeccable-surface aira-auth-surface min-h-dvh">{children}</div>;
}
