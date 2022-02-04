import cron from "node-cron";
import dayjs from "dayjs";
import { boatRace, logger } from "#/boatRace";
import { sendmail } from "#/sendmail";

async function main(): Promise<void> {
  logger.info("起動");

  // 毎日 08:30 に実行
  cron.schedule(
    "0 30 8 * * *",
    async () => {
      await boatRace();
    },
    { timezone: "Asia/Tokyo" }
  );

  // 08:30を過ぎて起動されたら処理を始める
  const startDayjs = dayjs().set("hour", 8).set("minute", 30).set("second", 0);
  const nowDayjs = dayjs();
  if (nowDayjs.isAfter(startDayjs)) {
    logger.info("08:30を過ぎたため実行");
    await boatRace();
  }
}

main().catch(async (err) => {
  console.error(err);

  await sendmail("システムダウン");

  process.exit(1);
});
