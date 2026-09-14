import React, { useState } from 'react'

const FAQS = [
	{
		q: 'What is Beta?',
		a: "I was fucking around making a mini coaching app that allows users to submit videos for review, and coaches to timestamp comment / annotate the videos. Somewhere along the way I added a gallery for B37 spray wall sets and a leaderboard for fun and that's the real main attraction now.",
	},
	{
		q: "What's a bounty?",
		a: "A route marked 💰 Bounty hasn't been climbed by anyone yet. Be the first to send it and submit a video as proof — you claim the FA (first ascent) and your name goes on the route. It's all for bragging rights.",
	},
	{
		q: 'How does the leaderboard work?',
		a: "If you're signed up, points scale with the grade and how many attempts it took. Base is grade * 1000 (V0 counts as 1000). A flash adds a 1000 bonus and takes no attempt penalty, so a V5 flash is 5000 + 1000 = 6000. Anything else is base - (100 * attempts), so a 4th go on a V5 is 5000 - 400 = 4600. An FA adds another 1000 on top. V0s don't get the flash bonus. If a route gets regraded, everyone's points for it move with it.",
	},
	{
		q: 'How do I submit a send?',
		a: "Open a route in the gallery, scroll to the send form, enter your name, optionally your grade opinion, and upload a video of you doing the problem start to finish. If you're not signed in you'll also need the gym passcode. ask me or anyone else already using the app.",
	},
	{
		q: "What's the gym passcode for?",
		a: "It keeps random internet visitors from uploading junk. Anyone at the gym can get it just ask. If you have an account and are signed in, you don't need it.",
	},
	{
		q: 'How are grades decided?',
		a: "The setter sets the grade. When you submit a send you can still say what you thought it was, and that shows up next to the route as what senders say, but it doesn't change the grade on its own. If enough people say a route is soft or sandbagged the setter will regrade it.",
	},
	{
		q: 'Do I need an account?',
		a: 'Not for browsing the gallery or submitting sends. You need an account for video coaching and to participate in the spray wall leaderboards.',
	},
	{
		q: 'How do I sign in without a password?',
		a: 'Choose "Use an email link instead" on the sign-in page and we\'ll email you a magic link no password needed. Once signed in, you can also set a password from the top bar if you prefer regular login.',
	},
	{
		q: 'How does video coaching work?',
		a: 'Students upload a climb from the dashboard with notes on what they want feedback on. A coach reviews it frame by frame, drawing directly on the video at specific timestamps, and you can reply in a comment thread on each moment.',
	},
	{
		q: 'What video formats work?',
		a: 'Standard phone videos (MP4/MOV) up to 200MB work fine. For route photos, JPEG and PNG are safest iPhone HEIC photos work when uploading from Safari.',
	},
]

export default function Faq() {
	const [open, setOpen] = useState(null)

	return (
		<main className='dashboard faq'>
			<h2>FAQ</h2>
			<div className='faq-list'>
				{FAQS.map((f, i) => (
					<div
						key={i}
						className={`faq-item ${open === i ? 'open' : ''}`}
					>
						<button
							className='faq-q'
							onClick={() => setOpen(open === i ? null : i)}
							aria-expanded={open === i}
						>
							<span>{f.q}</span>
							<span className='faq-chevron'>
								{open === i ? '−' : '+'}
							</span>
						</button>
						{open === i && <p className='faq-a'>{f.a}</p>}
					</div>
				))}
			</div>
		</main>
	)
}
