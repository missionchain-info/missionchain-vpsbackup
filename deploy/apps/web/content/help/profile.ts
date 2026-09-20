// Checked on 2026-09-20 against app/(dashboard)/profile/page.tsx and the routes that
// serve it in apps/api/src/routes/user.ts. Phone verification is Firebase Phone Auth:
// the browser receives the SMS through the Firebase SDK and the server verifies the
// returned ID token before recording anything. The email code's 10-minute expiry and the
// limit of 5 requests per wallet per hour are read from that route.
import type { Guide } from './types'

export const profile: Guide = {
  title: 'Profile',
  intro:
    'Profile is your account record and the place you verify who you are. There is no password ' +
    'anywhere in it: your wallet is the account, and verification adds an email address and a ' +
    'phone number on top of it so the project can reach you and so a person can be told apart ' +
    'from a second wallet.',
  howItWorks: [
    'Connecting your wallet is how you sign in. There is nothing to remember and nothing to reset, and disconnecting signs you out without affecting anything recorded here.',
    'Verification has two steps and they are taken in order: email first, then phone. The phone step stays locked until the email is verified, and that order is enforced by the server, not just greyed out in the page.',
    'Email: enter the address and a six-digit code is sent to it, then type the code back in. The code expires after 10 minutes and you may ask for at most 5 in an hour, so use them deliberately rather than clicking send again while you wait.',
    'Phone: enter the number in full international form, with the country code and a leading plus. The code arrives by SMS through the verification service, and the app then proves the result back to its own server before recording anything — a code you accepted in the browser only counts once the server has confirmed it.',
    'The phone step runs a silent anti-robot check in the browser before the SMS is sent. That check is the reason the phone step behaves differently in different browsers.',
    'Your member ID, your introducer and your join date were fixed when you registered and cannot be edited on this page. The email and phone are what you add here; the avatar and the text size are yours to change at any time.',
    'Telegram and WhatsApp in Social Connect are notification channels, not verification. Connecting them is optional, and doing so does not advance your verification level or replace either step above.',
    'Text size is remembered in this browser on this device. It is not part of your account, so another device starts at the default.',
  ],
  tips: [
    'The single commonest problem: phone verification does not work inside a wallet’s built-in browser. The anti-robot check is blocked there, so the code is never sent and the error rarely says why. Use the copy button the page offers, open the link in Safari or Chrome, connect your wallet there, and verify.',
    'Enter the phone number with its country code and a leading plus. A number typed in local form will be rejected or will send the code somewhere you are not.',
    'A verification code is six digits and is only ever typed into this page. Nobody legitimate will ever ask you to read one out, forward it, or paste it into a chat.',
    'Verifying does not change what your wallet can do. It does not unlock funds, does not grant a rank, and is not a way to recover a wallet — that is what your recovery phrase is for, and nobody here can help with it.',
    'Your introducer cannot be changed, here or anywhere. If it is wrong, it is wrong permanently, so check it before telling anyone they are under you.',
  ],
}
