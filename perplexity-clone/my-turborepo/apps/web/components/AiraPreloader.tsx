"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function AiraPreloader() {
	const [visible, setVisible] = useState(true);
	const shouldReduceMotion = useReducedMotion();
	const hasVisited = useRef(false);

	useEffect(() => {
		if (!hasVisited.current) {
			if (sessionStorage.getItem("aira-visited")) {
				setVisible(false);
				return;
			}
			sessionStorage.setItem("aira-visited", "true");
			hasVisited.current = true;
		}

		// Keep the splash non-blocking while allowing the logo line-art and wordmark
		// animations to complete before the overlay exits.
		const duration = shouldReduceMotion ? 0 : 1500;
		const timeout = window.setTimeout(() => setVisible(false), duration);
		return () => window.clearTimeout(timeout);
	}, [shouldReduceMotion]);

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					className="aira-preloader-container pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--aira-canvas)]"
					initial={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(10px)" }}
					transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
				>
					<motion.div
						initial={{ scale: 0.95, opacity: 1 }}
						animate={{ scale: 1, opacity: 1 }}
						transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
					>
						<svg
							viewBox="0 0 100 100"
							className="size-10 overflow-visible text-[var(--aira-text-0)]"
							fill="none"
						>
							<motion.path
								d="M20 80 L50 20 L80 80 M35 60 L65 60"
								stroke="currentColor"
								strokeWidth="8"
								strokeLinecap="square"
								strokeLinejoin="miter"
								initial={{ pathLength: 0 }}
								animate={{ pathLength: 1 }}
								transition={{ duration: 1.0, ease: "easeInOut" }}
							/>
						</svg>
					</motion.div>
					<motion.div
						className="mt-6 text-[12px] font-bold uppercase tracking-[0.3em] text-[var(--aira-text-0)]"
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
					>
						AIRA
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
