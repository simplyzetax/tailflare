function StateShell({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex min-h-screen items-center justify-center bg-paper px-6 py-10 text-ink">
			<div
				className="relative w-full max-w-md overflow-hidden rounded-[14px] border border-card-edge bg-paper-warm/90 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_28px_56px_-30px_rgba(74,58,37,0.4),0_4px_14px_-8px_rgba(74,58,37,0.18)]"
				style={{ animation: 'reveal 0.6s cubic-bezier(0.22,1,0.36,1) both' }}
			>
				<div className="relative p-7 md:p-9">{children}</div>
			</div>
		</main>
	);
}

function Eyebrow({ children, tone = 'brass' }: { children: React.ReactNode; tone?: 'brass' | 'red' }) {
	const color = tone === 'red' ? 'text-seal-red' : 'text-brass';
	const bar = tone === 'red' ? 'bg-seal-red' : 'bg-brass';
	return (
		<div className={`flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] ${color}`}>
			<span className={`inline-block h-px w-6 ${bar}`} />
			{children}
		</div>
	);
}

export function LoadingState() {
	return (
		<StateShell>
			<Eyebrow>Tailflare · Verifying</Eyebrow>
			<h1 className="mt-4 text-[1.875rem] font-semibold leading-tight tracking-tight text-ink">
				Checking your card…
			</h1>
			<p className="mt-3 text-sm text-ink-mute">Loading your signed tailnet identity.</p>

			<div className="mt-6 flex items-center gap-3">
				<span className="relative inline-flex h-2.5 w-2.5">
					<span
						aria-hidden
						className="absolute inline-flex h-full w-full rounded-full border border-brass"
						style={{ animation: 'radar 2.4s cubic-bezier(0.22,1,0.36,1) infinite' }}
					/>
					<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brass" />
				</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-mute">Awaiting signature</span>
			</div>
		</StateShell>
	);
}

export function SignedOutState() {
	return (
		<StateShell>
			<Eyebrow>Tailflare · Access Required</Eyebrow>
			<h1 className="mt-4 text-[2rem] font-semibold leading-[1.05] tracking-tight text-ink md:text-[2.25rem]">
				You are not signed in yet.
			</h1>
			<p className="mt-4 text-sm text-ink-mute">
				Prove you are on the tailnet, then Tailflare will issue a short-lived browser session and a tailnet identity card for this page.
			</p>

			<a
				href="/api/v1/notouchlogin"
				className="group mt-6 inline-flex items-center gap-3 rounded-[8px] bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.24em] text-paper-warm transition-all hover:bg-ink-soft hover:gap-4"
			>
				<span>Sign in through Tailscale</span>
				<span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
			</a>
		</StateShell>
	);
}

export function ErrorState({ message }: { message: string }) {
	return (
		<StateShell>
			<Eyebrow tone="red">Tailflare · Could Not Load</Eyebrow>
			<h1 className="mt-4 text-[1.875rem] font-semibold leading-tight tracking-tight text-ink">
				Something interrupted your card.
			</h1>
			<p className="mt-4 rounded-[8px] border border-seal-red/30 bg-[#fff1ed] px-4 py-3 font-mono text-[12px] text-[#7a2e22]">
				{message}
			</p>

			<button
				type="button"
				onClick={() => window.location.reload()}
				className="group mt-6 inline-flex items-center gap-3 rounded-[8px] bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.24em] text-paper-warm transition-all hover:bg-ink-soft hover:gap-4"
			>
				<span>Try again</span>
				<span aria-hidden className="transition-transform group-hover:translate-x-0.5">↻</span>
			</button>
		</StateShell>
	);
}
