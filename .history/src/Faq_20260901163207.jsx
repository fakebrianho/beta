import React, { useState } from "react";

const FAQS = [
  {
    q: "What is Beta?",
    a: "I was fucking around making a mini coaching app that allows users to submit videos for review, and coaches to timestamp comment / annotate the videos. Somewhere along the way I added a gallery for B37 spray wall sets and a leaderboard for fun and that's the real main attraction now.",
  },
  {
    q: "What's a bounty?",
    a: "A route marked 💰 Bounty hasn't been climbed by anyone yet. Be the first to send it and submit a video as proof — you claim the FA (first ascent) and your name goes on the route. It's all for bragging rights.",
  },
  {
    q:"How does the leaderboard work?",
    a:"If you're signed up, when you send a route you get points based on how many attempts it took. If you get an FA it's 5000 points, a flash is 3000 points (does not add "
  },
  {
    q: "How do I submit a send?",
    a: "Open a route in the gallery, scroll to the send form, enter your name, optionally your grade opinion, and upload a video of you doing the problem start to finish. If you're not signed in you'll also need the gym passcode — ask me or anyone else already using the app.",
  },
  {
    q: "What's the gym passcode for?",
    a: "It keeps random internet visitors from uploading junk. Anyone at the gym can get it — just ask. If you have an account and are signed in, you don't need it.",
  },
  {
    q: "How are grades decided?",
    a: "The grade shown on a route is the average of the setter's proposed grade and every grade submitted with a send. Think the grade is soft or sandbagged? Submit your send with your own grade opinion and move the needle.",
  },
  {
    q: "Do I need an account?",
    a: "Not for browsing the gallery or submitting sends. You need an account for video coaching — uploading climbs for feedback and reviewing them with your coach.",
  },
  {
    q: "How do I sign in without a password?",
    a: "Choose \"Use an email link instead\" on the sign-in page and we'll email you a magic link — no password needed. Once signed in, you can also set a password from the top bar if you prefer regular login.",
  },
  {
    q: "How does video coaching work?",
    a: "Students upload a climb from the dashboard with notes on what they want feedback on. A coach reviews it frame by frame, drawing directly on the video at specific timestamps, and you can reply in a comment thread on each moment.",
  },
  {
    q: "What video formats work?",
    a: "Standard phone videos (MP4/MOV) up to 200MB work fine. For route photos, JPEG and PNG are safest — iPhone HEIC photos work when uploading from Safari.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState(null);

  return (
    <main className="dashboard faq">
      <h2>FAQ</h2>
      <div className="faq-list">
        {FAQS.map((f, i) => (
          <div key={i} className={`faq-item ${open === i ? "open" : ""}`}>
            <button
              className="faq-q"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
            >
              <span>{f.q}</span>
              <span className="faq-chevron">{open === i ? "−" : "+"}</span>
            </button>
            {open === i && <p className="faq-a">{f.a}</p>}
          </div>
        ))}
      </div>
    </main>
  );
}
