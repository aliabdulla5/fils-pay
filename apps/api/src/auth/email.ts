import nodemailer from "nodemailer";
import type { Config } from "../config.js";

type OtpMailConfig = Pick<
  Config,
  | "otpSmtpHost"
  | "otpSmtpPort"
  | "otpSmtpSecure"
  | "otpSmtpUser"
  | "otpSmtpPassword"
  | "otpFromEmail"
  | "otpFromName"
>;

/** Deliver an OTP through the configured SMTP relay. No OTP or SMTP
 * credentials are logged, and SMTP errors are handled by the calling route. */
export async function deliverOtpEmail(
  config: OtpMailConfig,
  recipient: string,
  code: string,
  expiresInMinutes: number,
  audience: "merchant" | "admin",
): Promise<void> {
  if (!config.otpSmtpHost || !config.otpFromEmail) {
    throw new Error("OTP email is not configured");
  }
  if (Boolean(config.otpSmtpUser) !== Boolean(config.otpSmtpPassword)) {
    throw new Error("OTP SMTP username and password must be configured together");
  }

  const transporter = nodemailer.createTransport({
    host: config.otpSmtpHost,
    port: config.otpSmtpPort,
    secure: config.otpSmtpSecure,
    requireTLS: !config.otpSmtpSecure,
    ...(config.otpSmtpUser
      ? { auth: { user: config.otpSmtpUser, pass: config.otpSmtpPassword } }
      : {}),
  });
  const roleLabel = audience === "admin" ? "FilsPay administrator" : "FilsPay dashboard";
  const subject = "Your FilsPay sign-in code";
  const text = `Your ${roleLabel} verification code is ${code}. It expires in ${expiresInMinutes} minutes. If you did not request this code, you can ignore this email.`;

  await transporter.sendMail({
    from: { name: config.otpFromName, address: config.otpFromEmail },
    to: recipient,
    subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:24px auto;color:#17202a"><h2>Your FilsPay sign-in code</h2><p>Enter this code to continue to your ${roleLabel}:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in ${expiresInMinutes} minutes. If you did not request it, you can ignore this email.</p></div>`,
  });
}
