import type { Config } from "../config.js";
import { deliverOtpEmail } from "./email.js";

/** Subset of the Fastify logger, so callers can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

export async function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<
    Config,
    | "nodeEnv"
    | "otpTtlMinutes"
    | "otpSmtpHost"
    | "otpSmtpPort"
    | "otpSmtpSecure"
    | "otpSmtpUser"
    | "otpSmtpPassword"
    | "otpFromEmail"
    | "otpFromName"
  >,
  recipient: { merchantUserId: string; email: string },
  code: string,
): Promise<void> {
  const mailConfigured = Boolean(config.otpSmtpHost && config.otpFromEmail);
  if (mailConfigured) {
    await deliverOtpEmail(config, recipient.email, code, config.otpTtlMinutes, "merchant");
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp email sent");
    return;
  }

  if (config.nodeEnv === "production") {
    throw new Error("OTP email is not configured");
  }
  logger.info(
    { merchantUserId: recipient.merchantUserId, channel: "otp", code },
    "otp code generated (dev)",
  );
}
