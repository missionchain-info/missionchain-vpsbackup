// Checked against app/(dashboard)/nira/page.tsx and the API route list on 2026-09-20.
// The page is a placeholder: `handleSend` appends one hard-coded string after a 1s
// timeout, identical for every input. There is no model behind it and no request is made.
// It also has no transaction path of any kind — it imports no wallet client, no contract
// and no signer, and the only network call it makes is a GET for the avatar image. The
// limits below are therefore properties of the page, not promises about behaviour.
import type { Guide } from './types'

export const nira: Guide = {
  title: 'NIRA AI',
  intro:
    'NIRA is the assistant, and it is not finished. This page is a placeholder while the ' +
    'assistant is being built: you can type into it, but it does not yet answer questions. ' +
    'What is worth knowing now is where its limits will stay, because an assistant sitting ' +
    'next to your funds is exactly what somebody would want to impersonate.',
  howItWorks: [
    'The box takes what you type and returns the same short holding message every time, whatever you asked. It is not answering you: there is no model behind it yet, and nothing you type is sent anywhere.',
    'Nothing is kept. The thread is not part of your account, and leaving the page ends it.',
    'When it does answer, it will still never move funds or approve a transaction. It cannot send MIC or USDT, cannot place, fill or cancel an order, cannot stake, unstake or claim, and cannot buy or renew a licence. Everything that costs anything is signed by you, in your own wallet, on the page that action belongs to.',
    'It will never see a private key or a recovery phrase, and has no use for either. Nothing in Mission Chain ever needs one: connecting your wallet is how you prove who you are, and the key never leaves it.',
  ],
  tips: [
    'Never type a recovery phrase, a private key or a one-time code into this box — or into any box, on any site, for any reason. A request for one is an attack no matter who appears to be asking.',
    'Support that contacts you first is not support. Mission Chain will not message you asking you to connect a wallet, approve a contract, or move funds to keep them safe.',
  ],
}
