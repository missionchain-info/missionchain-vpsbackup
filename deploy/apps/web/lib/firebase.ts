import { initializeApp, getApps } from 'firebase/app'
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyB6VGVCftDufL-UjBWRFOdZJBcfQmLas7U",
  authDomain: "mission-chain-network.firebaseapp.com",
  projectId: "mission-chain-network",
  storageBucket: "mission-chain-network.firebasestorage.app",
  messagingSenderId: "830065332523",
  appId: "1:830065332523:web:45f8c1d801a24c4645756e",
  measurementId: "G-4X6RL4KH5G",
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
const auth = getAuth(app)

// Disable app verification for testing (remove in production)
// auth.settings.appVerificationDisabledForTesting = true

export { auth, RecaptchaVerifier, signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential }
