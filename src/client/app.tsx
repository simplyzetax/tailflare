import { useQuery } from '@tanstack/react-query';

import { IdentityPass } from './components/identity-pass';
import { ErrorState, LoadingState, SignedOutState } from './components/states';
import { orpc } from './orpc';

function isUnauthorizedError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		'status' in error &&
		(error as { code?: unknown }).code === 'UNAUTHORIZED' &&
		(error as { status?: unknown }).status === 401
	);
}

export function App() {
	const { data, isPending, error } = useQuery(orpc.me.queryOptions());

	if (isPending) return <LoadingState />;
	if (error) {
		if (isUnauthorizedError(error)) return <SignedOutState />;
		return <ErrorState message={error instanceof Error ? error.message : 'Unable to load your Tailflare session'} />;
	}

	return (
		<main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper px-4 py-12 text-ink md:px-6 md:py-16">
			<PageBackground />
			<div className="relative mx-auto w-full max-w-5xl">
				<IdentityPass data={data} />
			</div>
		</main>
	);
}

function PageBackground() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
			{/* Warm radial vignettes */}
			<div
				className="absolute inset-0"
				style={{
					backgroundImage:
						'radial-gradient(ellipse 1100px 720px at 12% -8%, rgba(200,169,106,0.22), transparent 60%), radial-gradient(ellipse 900px 600px at 108% 108%, rgba(139,46,31,0.08), transparent 55%), radial-gradient(ellipse 700px 500px at 50% 50%, rgba(255,249,237,0.4), transparent 70%)',
				}}
			/>

			{/* Faint engraved grid — like security paper */}
			<div
				className="absolute inset-0 opacity-[0.07]"
				style={{
					backgroundImage:
						'linear-gradient(to right, #2c2418 1px, transparent 1px), linear-gradient(to bottom, #2c2418 1px, transparent 1px)',
					backgroundSize: '64px 64px',
					maskImage: 'radial-gradient(ellipse 80% 80% at 50% 40%, black, transparent 90%)',
					WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 40%, black, transparent 90%)',
				}}
			/>

			{/* Guilloché concentric rings — far edges only, echoes the ID card */}
			<svg className="absolute -left-40 -top-40 h-[42rem] w-[42rem] opacity-[0.10] text-brass" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
				{Array.from({ length: 18 }).map((_, i) => (
					<circle key={i} cx="300" cy="300" r={30 + i * 16} fill="none" stroke="currentColor" strokeWidth="0.6" />
				))}
			</svg>
			<svg className="absolute -bottom-56 -right-56 h-[48rem] w-[48rem] opacity-[0.08] text-seal-red" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
				{Array.from({ length: 22 }).map((_, i) => (
					<circle key={i} cx="300" cy="300" r={20 + i * 14} fill="none" stroke="currentColor" strokeWidth="0.6" />
				))}
			</svg>

			{/* Compass-rose ornament, top right */}
			<svg className="absolute right-10 top-24 h-44 w-44 opacity-[0.09] text-brass md:right-20 md:top-32" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
				<circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="0.6" />
				<circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="0.6" />
				<circle cx="100" cy="100" r="48" fill="none" stroke="currentColor" strokeWidth="0.6" />
				{Array.from({ length: 24 }).map((_, i) => {
					const angle = (i * Math.PI) / 12;
					const x1 = 100 + Math.cos(angle) * 70;
					const y1 = 100 + Math.sin(angle) * 70;
					const x2 = 100 + Math.cos(angle) * 92;
					const y2 = 100 + Math.sin(angle) * 92;
					return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="0.7" />;
				})}
				<path d="M100 18 L108 100 L100 182 L92 100 Z" fill="currentColor" opacity="0.4" />
				<path d="M18 100 L100 108 L182 100 L100 92 Z" fill="currentColor" opacity="0.25" />
			</svg>

			{/* Paper grain — fractal noise SVG */}
			<div
				className="absolute inset-0 opacity-[0.45] mix-blend-multiply"
				style={{
					backgroundImage:
						"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0.17  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.16 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>\")",
					backgroundSize: '240px 240px',
				}}
			/>

			{/* Vignette to darken edges */}
			<div
				className="absolute inset-0"
				style={{
					boxShadow: 'inset 0 0 240px 60px rgba(74,58,37,0.18)',
				}}
			/>
		</div>
	);
}
