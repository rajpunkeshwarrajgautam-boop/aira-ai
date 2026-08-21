import "../impeccable-surfaces.css";

export default function PricingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <div className="aira-impeccable-surface aira-pricing-surface min-h-dvh">{children}</div>;
}
