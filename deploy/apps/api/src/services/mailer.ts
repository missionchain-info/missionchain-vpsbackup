import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const FROM_EMAIL = process.env.SMTP_FROM || 'MissionChain <noreply@missionchain.io>'

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[MAILER] SMTP not configured — OTP not sent. Code:', code)
    return
  }

  await transporter.sendMail({
    from: FROM_EMAIL,
    to,
    subject: `${code} — Your MissionChain verification code`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0C0812; color: #F0E6D3; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #C9A84C; margin: 0; font-size: 20px;">MissionChain</h2>
          <p style="color: #B09090; font-size: 12px; margin-top: 4px;">Email Verification</p>
        </div>
        <div style="text-align: center; padding: 24px; background: rgba(123,45,139,0.1); border-radius: 12px; border: 1px solid rgba(123,45,139,0.2);">
          <p style="color: #B09090; font-size: 13px; margin: 0 0 12px;">Your verification code:</p>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 0.3em; color: #C9A84C; font-family: monospace;">
            ${code}
          </div>
          <p style="color: #B09090; font-size: 11px; margin-top: 12px;">This code expires in 10 minutes.</p>
        </div>
        <p style="color: #7A6070; font-size: 11px; text-align: center; margin-top: 20px;">
          If you did not request this code, please ignore this email.
        </p>
      </div>
    `,
  })

  console.log(`[MAILER] OTP sent to ${to}`)
}

export async function sendPhoneOtpEmail(to: string, code: string): Promise<void> {
  // For phone verification, we still send via email for now
  // In production, integrate with Twilio/SMS provider
  console.warn('[MAILER] Phone OTP via SMS not yet implemented. Code:', code)
}
