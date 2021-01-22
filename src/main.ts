import cron from "node-cron";
import dayjs from "dayjs";
import { boatRace, logger } from "#/boatRace";

async function main(): Promise<void> {
  logger.info("起動");

  // 毎日 08:15 に実行
  cron.schedule(
    "0 15 8 * * *",
    async () => {
      await boatRace();
    },
    { timezone: "Asia/Tokyo" }
  );

  // 08:15を過ぎて起動されたら処理を始める
  const startDayjs = dayjs().set("hour", 8).set("minute", 15).set("second", 0);
  const nowDayjs = dayjs();
  if (nowDayjs.isAfter(startDayjs)) {
    logger.info("08:15を過ぎたため実行");
    await boatRace();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
