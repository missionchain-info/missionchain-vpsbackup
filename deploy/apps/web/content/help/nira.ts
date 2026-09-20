// Checked against app/(dashboard)/nira/page.tsx and the API route list on 2026-09-20.
// The page has no transaction path of any kind: it imports no wallet client, no contract
// and no signer, and the only network call it makes is a GET for the avatar image. The
// limits below are therefore properties of the page, not promises about behaviour.
import type { Guide } from './types'

export const nira: Guide = {
  title: 'NIRA AI',
  intro:
    'NIRA is the assistant: a place to ask a question in ordinary words and get an answer back. ' +
    'The useful thing to know about it is not what it can do but what it cannot, because an ' +
    'assistant that sits next to your funds is exactly what somebody would want to impersonate.',
  howItWorks: [
    'You type a question and an answer appears in the thread. That is the whole of it. Nothing is prepared, nothing is queued, and the conversation is not part of your account — leaving the page ends it.',
    'NIRA cannot move funds. It cannot send MIC or USDT, cannot place, fill or cancel an order, cannot stake, unstake or claim, and cannot buy or renew a licence. There is no path from this page to any of those actions.',
    'NIRA cannot approve a transaction. Everything that costs anything is signed by you, in your own wallet, on the page that action belongs to. An answer in this thread is never a signature and never stands in for one.',
    'NIRA cannot see a private key or a recovery phrase, and has no use for either. Nothing in Mission Chain ever needs one: connecting your wallet is how you prove who you are, and the key never leaves it.',
    'NIRA cannot change your account. Your member ID, your introducer, your verified email and phone, your rank and your permissions are not editable by asking.',
    'The assistant is still being built out. Treat what it tells you as a pointer to the right screen rather than as a reading, and confirm any figure on the page that owns it.',
  ],
  tips: [
    'Never type a recovery phrase, a private key or a one-time code into this box — or into any box, on any site, for any reason. A request for one is an attack no matter who appears to be asking.',
    'An answer here does not do anything. If something needs doing, you will do it yourself on that feature’s page, with your own signature, and you will see your wallet ask you to confirm it.',
    'Any figure mentioned in a conversation is a restatement, not a live reading. Check it on the screen that owns it before acting on it.',
    'Support that contacts you first is not support. Mission Chain will not message you asking you to connect a wallet, approve a contract, or move funds to keep them safe.',
  ],
}
