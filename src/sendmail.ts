import sgMail, { MailDataRequired } from "@sendgrid/mail";

import { logger } from "#/boatRace";
import { Config, readConfig } from "#/config";
import { getNow } from "#/myUtil";

/**
 * メール送信
 *
 * @param message
 */
export async function sendmail(message: string): Promise<void> {
  if (process.env.SENDGRID_API_KEY === undefined) {
    logger.error("SENDGRID_API_KEY is undefined.");
    return;
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const config: Config = await readConfig();

  const dateFormat = "YYYY-MM-DD HH:mm:ss";
  const now = getNow();

  const mailData: MailDataRequired = {
    to: config.email,
    from: config.email,
    subject: "mizuhanome " + now.format(dateFormat),
    text: message,
  };

  try {
    await sgMail.send(mailData);
  } catch (err) {
    logger.error(err);
    if (err.response) {
      logger.error(err.response.body);
    }
  }
}
