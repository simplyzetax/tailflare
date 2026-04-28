import { useState } from 'react';

import type { MeResponse } from '@tailflare/worker/auth/me';

type IdentityPassProps = {
	data: MeResponse;
};

function pad(n: number, len: number): string {
	return String(n).padStart(len, '0');
}

function formatDate(value: string | null): string {
	if (!value) return '—';
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return `${pad(d.getDate(), 2)}.${pad(d.getMonth() + 1, 2)}.${d.getFullYear()}`;
}

function buildMrz(data: MeResponse, idNumber: string): string[] {
	const country = 'TFL';
	const surname = (data.identity.subject ?? 'UNKNOWN')
		.replace(/[^A-Z0-9]/gi, '')
		.toUpperCase()
		.slice(0, 14) || 'UNKNOWN';
	const given = (data.identity.name ?? 'UNKNOWN')
		.replace(/[^A-Z0-9 ]/gi, '')
		.toUpperCase()
		.slice(0, 14) || 'UNKNOWN';
	const exp = data.session.expiresAt ? new Date(data.session.expiresAt) : null;
	const expDigits = exp
		? `${String(exp.getFullYear()).slice(2)}${pad(exp.getMonth() + 1, 2)}${pad(exp.getDate(), 2)}`
		: '000000';
	const num = idNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(9, '<').slice(0, 9);

	const line1 = `IDTFL${num}<<<<<<<<<<<<<<<`.slice(0, 30).padEnd(30, '<');
	const line2 = `${expDigits}1${country}<<<<<<<<<<<<<<<`.slice(0, 30).padEnd(30, '<');
	const line3 = `${surname}<<${given}`.replace(/\s+/g, '<').padEnd(30, '<').slice(0, 30);
	return [line1, line2, line3];
}

const CARD_BG =
	'linear-gradient(135deg, #1a1611 0%, #221c14 40%, #1a1611 100%)';

const CARD_RING =
	'0 1px 0 rgba(200,169,106,0.18) inset, 0 0 0 1px rgba(200,169,106,0.18) inset, 0 0 0 1px rgba(0,0,0,0.4)';

export function IdentityPass({ data }: IdentityPassProps) {
	const [clicked, setClicked] = useState(false);
	const [hovered, setHovered] = useState(false);
	const flipped = clicked !== hovered;

	const idNumber = (data.identity.machineKey ?? data.identity.nodeKey ?? 'UNKNOWN')
		.replace(/^[a-z]+:/i, '')
		.replace(/[^a-z0-9]/gi, '')
		.slice(0, 9)
		.toUpperCase()
		.padEnd(9, 'X');

	return (
		<section
			className="relative mx-auto w-full"
			style={{ animation: 'reveal 0.7s cubic-bezier(0.22,1,0.36,1) both' }}
		>
			{/* Perspective wrapper */}
			<div
				className="group relative mx-auto w-full cursor-pointer"
				style={{ perspective: '1800px', maxWidth: '880px' }}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onClick={() => setClicked((c) => !c)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setClicked((c) => !c);
					}
				}}
				tabIndex={0}
				role="button"
				aria-label={flipped ? 'Show card front' : 'Show card back'}
			>
				{/* Contact shadow — softens and widens during the mid-flip lift */}
				<div
					aria-hidden
					className="pointer-events-none absolute left-1/2 h-6 w-[88%] rounded-[50%]"
					style={{
						bottom: '-18px',
						background:
							'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(74,58,37,0.45), rgba(74,58,37,0.18) 50%, transparent 70%)',
						animation: `${flipped ? 'shadow-spread-a' : 'shadow-spread-b'} 0.95s cubic-bezier(0.22, 1, 0.36, 1) both`,
					}}
				/>

				{/* Lift wrapper — translateZ peaks mid-flip via keyframe.
				    We swap between two functionally identical animations so the keyframe
				    re-fires on every direction change without remounting children. */}
				<div
					className="relative w-full"
					style={{
						aspectRatio: '1.585 / 1',
						transformStyle: 'preserve-3d',
						animation: `${flipped ? 'flip-lift-a' : 'flip-lift-b'} 0.95s cubic-bezier(0.22, 1, 0.36, 1) both`,
					}}
				>
					{/* Rotation flipper — transition handles in-flight reversal cleanly */}
					<div
						className="relative h-full w-full"
						style={{
							transformStyle: 'preserve-3d',
							transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
							transition: 'transform 0.95s cubic-bezier(0.22, 1, 0.36, 1)',
						}}
					>
						{/* Depth slabs — sandwiched between front and back. Invisible at rest,
					    visible during rotation as real thickness. */}
						<CardDepthStack layers={9} thickness={14} />

						{/* FRONT */}
						<div
							className="absolute inset-0"
							style={{
								backfaceVisibility: 'hidden',
								WebkitBackfaceVisibility: 'hidden',
								transform: 'translateZ(7px)',
							}}
						>
							<CardFront data={data} idNumber={idNumber} />
							<Sheen trigger={flipped} />
						</div>

						{/* BACK */}
						<div
							className="absolute inset-0"
							style={{
								backfaceVisibility: 'hidden',
								WebkitBackfaceVisibility: 'hidden',
								transform: 'rotateY(180deg) translateZ(7px)',
							}}
						>
							<CardBack data={data} idNumber={idNumber} />
							<Sheen trigger={flipped} />
						</div>
					</div>
				</div>
			</div>

			{/* Caption row */}
			<div className="mx-auto mt-6 flex max-w-[880px] items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-mute">
				<span>Tailflare · Bearer Credential · Class A</span>
				<span className="flex items-center gap-2 tabular-nums">
					<span
						aria-hidden
						className="inline-block h-1 w-1 rounded-full"
						style={{ background: '#c8a96a' }}
					/>
					<span>{flipped ? 'showing back · click to flip' : 'click or hover to flip'}</span>
				</span>
			</div>
		</section>
	);
}

/* ─────────────────── FRONT ─────────────────── */

function CardFront({ data, idNumber }: { data: MeResponse; idNumber: string }) {
	const displayName = data.identity.name ?? data.identity.subject ?? 'Unknown';
	const subject = data.identity.subject ?? '—';
	const primaryAddress = data.identity.addresses[0] ?? data.tailflare.self?.ipv4 ?? '—';
	const ipv6 = data.tailflare.self?.ipv6 ?? '—';
	const host = data.tailflare.self?.host ?? '—';
	const initials =
		displayName
			.split(/\s+|@|[._-]/)
			.filter(Boolean)
			.slice(0, 2)
			.map((s) => s[0]?.toUpperCase() ?? '')
			.join('') || 'TF';

	const mrzLines = buildMrz(data, idNumber);

	return (
		<article
			className="relative h-full w-full overflow-hidden rounded-[20px] text-[#e8d8b5]"
			style={{ background: CARD_BG, boxShadow: CARD_RING }}
		>
			<CardSurface />
			<CornerMarks />

			{/* HEADER */}
			<header className="relative flex items-center justify-between px-6 pt-5 md:px-8 md:pt-6">
				<div className="flex items-center gap-3">
					<GoldEmblem />
					<div className="leading-none">
						<p
							className="font-mono text-[9px] uppercase tracking-[0.32em] md:text-[10px]"
							style={{ color: '#8a7549' }}
						>
							Republic of the Tailnet
						</p>
						<p
							className="mt-1.5 text-[15px] font-semibold tracking-tight md:text-[17px]"
							style={{
								background: 'linear-gradient(180deg, #f1dca0 0%, #c8a96a 50%, #8a7549 100%)',
								WebkitBackgroundClip: 'text',
								backgroundClip: 'text',
								color: 'transparent',
							}}
						>
							Biometric Identity Card
						</p>
					</div>
				</div>
			</header>

			<GoldRule />

			{/* BODY */}
			<div className="relative grid h-[calc(100%-5.5rem)] grid-cols-[36%_1fr] gap-0 px-6 pb-6 pt-5 md:h-[calc(100%-6rem)] md:grid-cols-[32%_1fr] md:px-8 md:pb-8 md:pt-6">
				{/* LEFT */}
				<div className="relative flex flex-col gap-4">
					<div
						className="relative flex-1 overflow-hidden rounded-[8px]"
						style={{
							clipPath:
								'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)',
							background:
								'linear-gradient(155deg, #2c2418 0%, #3a2f1f 50%, #1a1611 100%)',
							boxShadow:
								'0 0 0 1px rgba(200,169,106,0.25) inset, 0 8px 24px -12px rgba(0,0,0,0.6) inset',
						}}
					>
						<div className="absolute inset-0 flex items-center justify-center">
							<div
								className="flex h-[72%] w-[72%] items-center justify-center rounded-full"
								style={{
									background:
										'radial-gradient(circle at 30% 25%, rgba(255,235,200,0.18), transparent 55%), linear-gradient(160deg, #4a3a25 0%, #2c2418 100%)',
									boxShadow:
										'inset 0 2px 6px rgba(255,235,200,0.15), inset 0 -2px 6px rgba(0,0,0,0.5), 0 0 30px -6px rgba(200,169,106,0.2)',
								}}
							>
								<span
									className="text-[2.75rem] font-bold tracking-tight md:text-[3.25rem]"
									style={{
										background:
											'linear-gradient(180deg, #f1dca0 0%, #c8a96a 60%, #8a7549 100%)',
										WebkitBackgroundClip: 'text',
										backgroundClip: 'text',
										color: 'transparent',
									}}
								>
									{initials}
								</span>
							</div>
						</div>

						<div
							aria-hidden
							className="pointer-events-none absolute inset-0 opacity-[0.12]"
							style={{
								backgroundImage:
									'repeating-linear-gradient(0deg, #c8a96a 0 1px, transparent 1px 4px)',
							}}
						/>

						<div
							aria-hidden
							className="absolute right-2 top-2 h-5 w-5 rounded-full opacity-90"
							style={{
								background:
									'conic-gradient(from 0deg, rgba(200,169,106,0.95), rgba(143,73,182,0.6), rgba(82,168,232,0.7), rgba(200,169,106,0.95))',
								animation: 'hologram-shift 6s ease-in-out infinite',
								backgroundSize: '200% 200%',
								filter: 'blur(0.4px)',
							}}
						/>

						<div className="absolute bottom-2 left-2 font-mono text-[8px] uppercase tracking-[0.28em] opacity-60">
							IMG · 04
						</div>
					</div>

					<div className="flex shrink-0 items-center gap-3">
						<NFCChip />
						<ContactlessIcon />
						<div className="ml-auto text-right leading-none">
							<p className="font-mono text-[8px] uppercase tracking-[0.28em]" style={{ color: '#8a7549' }}>
								Card No.
							</p>
							<p className="mt-1 font-mono text-[12px] tabular-nums" style={{ color: '#e8d8b5' }}>
								{idNumber}
							</p>
						</div>
					</div>
				</div>

				{/* RIGHT */}
				<div className="relative flex flex-col pl-6 md:pl-8">
					<div>
						<p className="font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: '#8a7549' }}>
							Bearer
						</p>
						<p
							className="mt-1 truncate text-[1.5rem] font-semibold tracking-tight md:text-[2rem]"
							title={displayName}
							style={{
								background: 'linear-gradient(180deg, #f1dca0 0%, #c8a96a 55%, #6e5a37 100%)',
								WebkitBackgroundClip: 'text',
								backgroundClip: 'text',
								color: 'transparent',
							}}
						>
							{displayName}
						</p>
					</div>

					<div className="mt-4 grid flex-1 grid-cols-2 gap-x-5 gap-y-3 md:gap-x-7 md:gap-y-3.5">
						<EngravedField label="Subject ID" value={subject} mono />
						<EngravedField label="Hostname" value={host} mono />
						<EngravedField label="IPv4" value={primaryAddress} mono />
						<EngravedField label="IPv6" value={ipv6} mono small />
						<EngravedField label="MagicDNS" value={data.tailflare.self?.magicDNSName ?? '—'} mono small />
						<EngravedField label="Peers visible" value={String(data.tailflare.peerCount)} mono />
						<EngravedField label="Issued" value={formatDate(data.session.issuedAt)} mono />
						<EngravedField label="Expires" value={formatDate(data.session.expiresAt)} mono />
					</div>

					<div className="mt-4 md:mt-5">
						<div className="flex items-center gap-2">
							<p className="font-mono text-[8px] uppercase tracking-[0.28em]" style={{ color: '#8a7549' }}>
								Machine Readable Zone
							</p>
							<div
								className="h-px flex-1"
								style={{
									background:
										'linear-gradient(90deg, rgba(200,169,106,0.4) 0%, transparent 100%)',
								}}
							/>
						</div>
						<div
							className="relative mt-1.5 overflow-hidden rounded-[4px] px-2.5 py-1.5"
							style={{
								background: 'rgba(0,0,0,0.35)',
								boxShadow: '0 0 0 1px rgba(200,169,106,0.15) inset',
							}}
						>
							<pre
								className="whitespace-pre font-mono text-[10px] leading-[1.55] tracking-[0.06em] md:text-[11px] md:leading-[1.6]"
								style={{ color: '#e8d8b5' }}
							>
								{mrzLines.join('\n')}
							</pre>
							<div
								aria-hidden
								className="pointer-events-none absolute inset-0 opacity-[0.10]"
								style={{
									backgroundImage:
										'repeating-linear-gradient(0deg, #c8a96a 0 1px, transparent 1px 3px)',
								}}
							/>
						</div>
					</div>
				</div>
			</div>
		</article>
	);
}

/* ─────────────────── BACK ─────────────────── */

function CardBack({ data, idNumber }: { data: MeResponse; idNumber: string }) {
	const peers = data.tailflare.peers.slice(0, 6);
	const remaining = Math.max(0, data.tailflare.peerCount - peers.length);
	const machineKey = data.identity.machineKey ?? '—';
	const nodeKey = data.identity.nodeKey ?? '—';
	const allAddresses = data.identity.addresses.join(', ') || '—';

	return (
		<article
			className="relative h-full w-full overflow-hidden rounded-[20px] text-[#e8d8b5]"
			style={{ background: CARD_BG, boxShadow: CARD_RING }}
		>
			<CardSurface seed={11} />
			<CornerMarks />

			{/* Body */}
			<div className="relative flex h-full flex-col px-6 pb-6 pt-5 md:px-8 md:pb-8 md:pt-6">
				{/* Title row */}
				<header className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden style={{ color: '#c8a96a' }}>
							<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
							<path d="M3 10 H21 M7 14 H10 M7 16 H13" stroke="currentColor" strokeWidth="1.2" />
						</svg>
						<div className="leading-none">
							<p
								className="font-mono text-[9px] uppercase tracking-[0.32em] md:text-[10px]"
								style={{ color: '#8a7549' }}
							>
								Verso · Supplementary
							</p>
							<p
								className="mt-1.5 text-[14px] font-semibold tracking-tight md:text-[16px]"
								style={{
									background:
										'linear-gradient(180deg, #f1dca0 0%, #c8a96a 50%, #8a7549 100%)',
									WebkitBackgroundClip: 'text',
									backgroundClip: 'text',
									color: 'transparent',
								}}
							>
								Cryptographic Identity & Peer Manifest
							</p>
						</div>
					</div>
					<div className="text-right leading-none">
						<p className="font-mono text-[9px] uppercase tracking-[0.28em]" style={{ color: '#8a7549' }}>
							Card No.
						</p>
						<p className="mt-1 font-mono text-[11px] tabular-nums" style={{ color: '#e8d8b5' }}>
							{idNumber}
						</p>
					</div>
				</header>

				<GoldRule className="mt-3" />

				{/* Two-column body */}
				<div className="mt-3 grid flex-1 grid-cols-[1.05fr_1fr] gap-5 md:mt-4 md:gap-7">
					{/* LEFT: crypto */}
					<div className="flex flex-col gap-3">
						<KeyField label="Machine Key" value={machineKey} />
						<KeyField label="Node Key" value={nodeKey} />
						<KeyField label="All Addresses" value={allAddresses} compact />
						<div className="mt-auto">
							<Barcode value={idNumber} />
						</div>
					</div>

					{/* RIGHT: peer manifest */}
					<div className="flex min-w-0 flex-col">
						<div className="flex items-center justify-between">
							<p className="font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: '#8a7549' }}>
								Peer Manifest
							</p>
							<p className="font-mono text-[9px] uppercase tracking-[0.24em]" style={{ color: '#8a7549' }}>
								{peers.length} / {data.tailflare.peerCount}
							</p>
						</div>
						<div
							className="mt-1.5 flex-1 overflow-hidden rounded-[4px]"
							style={{
								background: 'rgba(0,0,0,0.30)',
								boxShadow: '0 0 0 1px rgba(200,169,106,0.15) inset',
							}}
						>
							<div
								className="grid grid-cols-[1.5rem_1fr_1.4fr] items-center px-2.5 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.24em] md:text-[9px]"
								style={{
									color: '#8a7549',
									borderBottom: '1px solid rgba(200,169,106,0.2)',
								}}
							>
								<span>№</span>
								<span>Name</span>
								<span>Addresses</span>
							</div>
							{peers.length > 0 ? (
								<ul>
									{peers.map((peer, index) => (
										<li
											key={`${peer.nodeKey ?? peer.machineKey ?? peer.name ?? 'peer'}-${index}`}
											className="grid grid-cols-[1.5rem_1fr_1.4fr] items-baseline gap-2 px-2.5 py-1"
											style={{
												borderBottom:
													index === peers.length - 1
														? 'none'
														: '1px dashed rgba(200,169,106,0.15)',
											}}
										>
											<span className="font-mono text-[10px] tabular-nums" style={{ color: '#8a7549' }}>
												{String(index + 1).padStart(2, '0')}
											</span>
											<span
												className="truncate text-[11px] font-medium"
												title={peer.name ?? undefined}
												style={{ color: '#e8d8b5' }}
											>
												{peer.name ?? 'Unknown'}
											</span>
											<span
												className="truncate font-mono text-[10px] tabular-nums"
												title={peer.addresses.join(', ')}
												style={{ color: '#c8b07a' }}
											>
												{peer.addresses[0] ?? '—'}
											</span>
										</li>
									))}
								</ul>
							) : (
								<div className="px-2.5 py-3 text-center font-mono text-[9px] uppercase tracking-[0.28em]" style={{ color: '#8a7549' }}>
									No peers returned.
								</div>
							)}
							{remaining > 0 ? (
								<div
									className="px-2.5 py-1 text-center font-mono text-[8.5px] uppercase tracking-[0.28em]"
									style={{
										color: '#8a7549',
										borderTop: '1px solid rgba(200,169,106,0.2)',
									}}
								>
									+ {remaining} more not shown
								</div>
							) : null}
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="mt-4 flex items-center justify-between">
					<p className="font-mono text-[8.5px] uppercase tracking-[0.28em]" style={{ color: '#8a7549' }}>
						This card remains property of Tailflare Authority. Non-transferable.
					</p>
					<p className="font-mono text-[9px] tabular-nums" style={{ color: '#e8d8b5' }}>
						Issued {formatDate(data.session.issuedAt)} · Expires {formatDate(data.session.expiresAt)}
					</p>
				</div>
			</div>
		</article>
	);
}

/* ─────────────────── shared bits ─────────────────── */

function CardSurface({ seed = 5 }: { seed?: number }) {
	return (
		<>
			{/* brushed metal */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-[0.12]"
				style={{
					backgroundImage:
						'repeating-linear-gradient(90deg, rgba(200,169,106,0.4) 0 1px, transparent 1px 3px)',
				}}
			/>
			{/* warm radial light */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					background:
						'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(200,169,106,0.10), transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(139,46,31,0.10), transparent 70%)',
				}}
			/>
			{/* grain */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-50 mix-blend-overlay"
				style={{
					backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' seed='${seed}'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 0.85  0 0 0 0 0.55  0 0 0 0.18 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
					backgroundSize: '200px 200px',
				}}
			/>
		</>
	);
}

function CornerMarks() {
	return (
		<>
			<RegMark className="left-3 top-3" />
			<RegMark className="right-3 top-3" rotate={90} />
			<RegMark className="left-3 bottom-3" rotate={-90} />
			<RegMark className="right-3 bottom-3" rotate={180} />
		</>
	);
}

function GoldRule({ className = '' }: { className?: string }) {
	return (
		<div
			className={`mx-6 h-px md:mx-8 ${className}`}
			style={{
				background:
					'linear-gradient(90deg, transparent 0%, rgba(200,169,106,0.5) 20%, rgba(200,169,106,0.7) 50%, rgba(200,169,106,0.5) 80%, transparent 100%)',
			}}
		/>
	);
}

function RegMark({ className, rotate = 0 }: { className?: string; rotate?: number }) {
	return (
		<svg
			aria-hidden
			className={`pointer-events-none absolute h-3 w-3 ${className ?? ''}`}
			viewBox="0 0 12 12"
			style={{ transform: `rotate(${rotate}deg)`, color: '#c8a96a' }}
		>
			<path d="M0 0 L6 0 M0 0 L0 6" stroke="currentColor" strokeWidth="1" opacity="0.6" />
		</svg>
	);
}

function GoldEmblem() {
	return (
		<svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0" aria-hidden>
			<defs>
				<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#f1dca0" />
					<stop offset="50%" stopColor="#c8a96a" />
					<stop offset="100%" stopColor="#6e5a37" />
				</linearGradient>
			</defs>
			<circle cx="18" cy="18" r="16" fill="none" stroke="url(#gold)" strokeWidth="1" />
			<circle cx="18" cy="18" r="12" fill="none" stroke="url(#gold)" strokeWidth="0.6" />
			<path
				d="M18 6 L20 17 L30 18 L20 19 L18 30 L16 19 L6 18 L16 17 Z"
				fill="url(#gold)"
				opacity="0.95"
			/>
			<circle cx="18" cy="18" r="2" fill="#1a1611" />
		</svg>
	);
}

function NFCChip() {
	return (
		<svg viewBox="0 0 48 36" className="h-9 w-12 shrink-0" aria-hidden>
			<defs>
				<linearGradient id="chip" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#f1dca0" />
					<stop offset="50%" stopColor="#c8a96a" />
					<stop offset="100%" stopColor="#6e5a37" />
				</linearGradient>
				<linearGradient id="chip-pad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#e8d09a" />
					<stop offset="100%" stopColor="#8a7549" />
				</linearGradient>
			</defs>
			<rect x="0.5" y="0.5" width="47" height="35" rx="5" fill="url(#chip)" stroke="#6e5a37" strokeWidth="0.6" />
			<rect x="4" y="4" width="14" height="9" rx="1.2" fill="url(#chip-pad)" />
			<rect x="20" y="4" width="9" height="9" rx="1.2" fill="url(#chip-pad)" />
			<rect x="31" y="4" width="13" height="9" rx="1.2" fill="url(#chip-pad)" />
			<rect x="4" y="15" width="14" height="9" rx="1.2" fill="url(#chip-pad)" />
			<rect x="20" y="15" width="9" height="9" rx="1.2" fill="url(#chip-pad)" />
			<rect x="31" y="15" width="13" height="9" rx="1.2" fill="url(#chip-pad)" />
			<path
				d="M20 9 L29 9 M20 19 L29 19 M24 4 L24 32 M4 26 L44 26 M4 30 L44 30"
				stroke="#6e5a37"
				strokeWidth="0.4"
				opacity="0.6"
			/>
			<rect x="0.5" y="0.5" width="47" height="3" rx="2" fill="rgba(255,235,200,0.4)" />
		</svg>
	);
}

function ContactlessIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden style={{ color: '#c8a96a' }}>
			<path d="M7 7 C 10 9, 10 15, 7 17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
			<path d="M11 5 C 16 8, 16 16, 11 19" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
			<path d="M15 3 C 22 7, 22 17, 15 21" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

function EngravedField({
	label,
	value,
	mono,
	small,
}: {
	label: string;
	value: string;
	mono?: boolean;
	small?: boolean;
}) {
	const sizeClass = small ? 'text-[11px] md:text-[12px]' : 'text-[13px] md:text-[14px]';
	return (
		<div className="min-w-0">
			<p className="font-mono text-[8px] uppercase tracking-[0.28em] md:text-[9px]" style={{ color: '#8a7549' }}>
				{label}
			</p>
			<p
				className={[
					'mt-0.5 truncate font-medium',
					mono ? 'font-mono tabular-nums' : '',
					sizeClass,
				].join(' ')}
				title={value}
				style={{
					color: '#e8d8b5',
					textShadow: '0 1px 0 rgba(0,0,0,0.5), 0 -1px 0 rgba(255,235,200,0.05)',
				}}
			>
				{value}
			</p>
		</div>
	);
}

function KeyField({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
	return (
		<div className="min-w-0">
			<div className="flex items-center justify-between">
				<p className="font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: '#8a7549' }}>
					{label}
				</p>
				<p className="font-mono text-[8.5px] uppercase tracking-[0.24em]" style={{ color: '#8a7549' }}>
					{value === '—' ? '—' : `${value.length} ch`}
				</p>
			</div>
			<div
				className="mt-1 overflow-hidden rounded-[4px] px-2 py-1.5"
				style={{
					background: 'rgba(0,0,0,0.30)',
					boxShadow: '0 0 0 1px rgba(200,169,106,0.15) inset',
				}}
			>
				<p
					className={`break-all font-mono tabular-nums ${compact ? 'text-[10px]' : 'text-[10.5px]'} leading-[1.5]`}
					style={{ color: '#e8d8b5' }}
				>
					{value}
				</p>
			</div>
		</div>
	);
}

/**
 * A stack of identical thin slabs at different translateZ depths between the
 * front and back. From any non-perpendicular angle you perceive real thickness;
 * at 0°/180° the front face occludes them entirely so they're invisible at rest.
 */
function CardDepthStack({ layers = 7, thickness = 14 }: { layers?: number; thickness?: number }) {
	const slabs = Array.from({ length: layers });
	return (
		<>
			{slabs.map((_, i) => {
				const t = i / (layers - 1); // 0 → 1
				const z = thickness / 2 - t * thickness; // +half → -half
				// Darker toward the back of the stack
				const shade = Math.round(20 + (1 - Math.abs(0.5 - t) * 2) * 8);
				return (
					<div
						key={i}
						aria-hidden
						className="pointer-events-none absolute inset-0 rounded-[20px]"
						style={{
							background: `rgb(${shade}, ${shade - 2}, ${shade - 6})`,
							transform: `translateZ(${z}px)`,
							boxShadow: '0 0 0 1px rgba(200,169,106,0.08) inset',
						}}
					/>
				);
			})}
		</>
	);
}

/**
 * A specular highlight that sweeps across the face during a flip — gives
 * the impression of light catching the surface as it rotates.
 */
function Sheen({ trigger }: { trigger: boolean }) {
	return (
		<div
			key={String(trigger)}
			aria-hidden
			className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]"
		>
			<div
				className="absolute inset-y-[-20%] w-[40%]"
				style={{
					background:
						'linear-gradient(90deg, transparent 0%, rgba(255,235,200,0.0) 20%, rgba(255,235,200,0.45) 50%, rgba(255,235,200,0.0) 80%, transparent 100%)',
					filter: 'blur(8px)',
					mixBlendMode: 'overlay',
					animation: 'sheen-sweep 0.95s cubic-bezier(0.22, 1, 0.36, 1) both',
				}}
			/>
		</div>
	);
}

function Barcode({ value }: { value: string }) {
	const seed = Array.from(value).reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7);
	const bars: Array<{ x: number; w: number }> = [];
	let x = 0;
	let s = seed;
	const total = 200;
	while (x < total) {
		s = (s * 9301 + 49297) % 233280;
		const w = 1 + (s % 4);
		s = (s * 9301 + 49297) % 233280;
		const gap = 1 + (s % 3);
		bars.push({ x, w });
		x += w + gap;
	}
	return (
		<div className="overflow-hidden rounded-[4px]" style={{ background: 'rgba(232,216,181,0.92)', padding: '6px 8px' }}>
			<svg viewBox={`0 0 ${total} 28`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
				{bars.map((b, i) => (
					<rect key={i} x={b.x} y="0" width={b.w} height="28" fill="#1a1611" />
				))}
			</svg>
			<p
				className="mt-1 text-center font-mono text-[9px] tabular-nums tracking-[0.3em]"
				style={{ color: '#1a1611' }}
			>
				{value}
			</p>
		</div>
	);
}
