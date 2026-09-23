"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/cn";

export function AiraLogo({ className, href = "/" }: { readonly className?: string; readonly href?: string }) {
	return (
		<Link href={href} className={cn("group flex items-center gap-3", className)} aria-label="AIRA AI home">
			<div className="relative flex size-7 items-center justify-center">
				<svg viewBox="0 0 100 100" className="size-full overflow-visible" fill="none">
					{/* Outer Orbit (Connect phase) */}
					<motion.circle
						cx="50"
						cy="50"
						r="42"
						stroke="#8B7CFF"
						strokeWidth="4"
						strokeDasharray="4 8"
						initial={{ opacity: 0, scale: 0.8, rotate: -90 }}
						animate={{ 
							opacity: [0, 0, 1, 0], 
							scale: [0.8, 0.8, 1, 1.1],
							rotate: [-90, -90, 90, 180] 
						}}
						transition={{ duration: 3, ease: "easeInOut", times: [0, 0.4, 0.7, 1] }}
					/>
					
					{/* Central Form Assembly (Form phase) */}
					<motion.path 
						d="M20 80 L50 20 L80 80 M35 60 L65 60" 
						stroke="#0F172A" 
						strokeWidth="8" 
						strokeLinecap="square" 
						strokeLinejoin="miter" 
						initial={{ pathLength: 0, opacity: 0 }}
						animate={{ pathLength: 1, opacity: 1 }}
						transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
					/>
					
					{/* Core Pulse (Awaken phase) */}
					<motion.circle
						cx="50"
						cy="50"
						r="8"
						fill="#8B7CFF"
						initial={{ scale: 0, opacity: 0 }}
						animate={{ scale: [0, 1.5, 0], opacity: [0, 1, 0] }}
						transition={{ duration: 1.5, ease: "easeOut" }}
					/>
				</svg>
			</div>
			<span className="text-[14px] font-bold tracking-[0.15em] text-[#0F172A] uppercase">
				AIRA
			</span>
		</Link>
	);
}
