import type { Config } from "../config.js";
import { deliverOtpEmail } from "../auth/email.js";
import type { MinimalLogger } from "../auth/notifier.js";

export async function sendAdminOtpCode(
  logger: MinimalLogger,
  config: Pick<
    Config,
    | "nodeEnv"
    | "adminOtpTtlMinutes"
    | "otpSmtpHost"
    | "otpSmtpPort"
    | "otpSmtpSecure"
    | "otpSmtpUser"
    | "otpSmtpPassword"
    | "otpFromEmail"
    | "otpFromName"
  >,
  recipient: { adminUserId: string; email: string },
  code: string,
): Promise<void> {
  const mailConfigured = Boolean(config.otpSmtpHost && config.otpFromEmail);
  if (mailConfigured) {
    await deliverOtpEmail(config, recipient.email, code, config.adminOtpTtlMinutes, "admin");
    logger.info({ adminUserId: recipient.adminUserId, channel: "admin_otp" }, "admin otp email sent");
    return;
  }

  if (config.nodeEnv === "production") {
    throw new Error("OTP email is not configured");
  }
  logger.info(
    { adminUserId: recipient.adminUserId, channel: "admin_otp", code },
    "admin otp code generated (dev)",
  );
}
